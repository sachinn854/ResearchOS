import logging
from collections import Counter
from dataclasses import dataclass

import fitz  # PyMuPDF

from backend.ingestion.parsers.base import BaseParser, ParsedPage

log = logging.getLogger("researchos.ingestion.parsers.pdf")

# Lazy import — the image describer pulls in the LLM client, which we don't want
# to load for non-PDF pipelines.
_describe_image = None


def _get_image_describer():
    global _describe_image
    if _describe_image is None:
        from backend.ingestion.multimodal.image_describer import describe_image
        _describe_image = describe_image
    return _describe_image


@dataclass
class _Line:
    """One visual line of text, plus the font facts we need to guess whether it
    is a heading. A PDF has no notion of "heading" — it only knows "this text is
    drawn at 14pt bold". So we have to infer structure from how it looks."""
    text: str
    page_number: int
    font_size: float
    is_bold: bool


class PDFParser(BaseParser):
    """Parses a PDF into sections, not raw pages.

    BUG-021: this used to return one ParsedPage per physical page, and the
    pipeline then handed PDFs to RecursiveChunker. That splits purely on
    character count, so a chunk regularly started in the middle of "Results"
    and ended inside "Discussion". Retrieval then returned a chunk whose first
    half answered the question and whose second half was about something else.

    Now we detect headings from font size and boldness, and emit one ParsedPage
    per section — the same shape DOCXParser already produced. HeadingChunker
    then splits only *within* a section, so no chunk ever straddles two
    sections.

    (pymupdf4llm's `to_markdown()` does heading detection too, but it rewrites
    the whole document into Markdown and does not fit our per-page image
    description flow, so we do the detection ourselves.)
    """

    # BUG-023: cap images per page to avoid a 2000-call blowup on figure-heavy PDFs
    _MAX_IMAGES_PER_PAGE = 5

    # --- heading detection tuning -------------------------------------------
    # Headings are short. A longer line is a paragraph that merely happens to be
    # bold or slightly larger.
    _MAX_HEADING_CHARS = 120
    # Headings are usually drawn at least 10% larger than body text.
    _HEADING_SIZE_RATIO = 1.10
    # With 0 or 1 headings there is no structure worth preserving, and merging
    # everything into one section would throw away page numbers we need for
    # citations. In that case we fall back to the old per-page behaviour.
    _MIN_HEADINGS = 2
    # A section carries ONE page number, and every chunk cut from it inherits it.
    # On a paper where heading detection found little, one section swallowed 11
    # pages and all of its chunks were then cited as "page 1" — a citation
    # pointing at the wrong page is worse than a slightly clumsy split. So a
    # section is never allowed to leave the page it started on.
    #
    # This costs almost nothing. Any section longer than the 800-char chunk size
    # was going to be split by HeadingChunker regardless; we simply force one of
    # those splits to land on the page break. And the old per-page code cut at
    # every page break anyway, so nothing got worse — we only added the heading
    # breaks *within* a page, which is exactly what BUG-021 asked for.
    _MAX_SECTION_PAGE_SPAN = 1

    def __init__(self, extract_images: bool = True, detect_headings: bool = True):
        self.extract_images = extract_images
        self.detect_headings = detect_headings

    def parse(self, source: str) -> list[ParsedPage]:
        describer = _get_image_describer() if self.extract_images else None

        # Read every page once. We keep lines (not joined text) because heading
        # detection needs the per-line font size, and joining throws that away.
        lines_by_page: dict[int, list[_Line]] = {}
        images_by_page: dict[int, list[str]] = {}

        with fitz.open(source) as doc:
            for page_num, page in enumerate(doc, start=1):
                lines_by_page[page_num] = self._read_lines(page, page_num)

                if describer:
                    descriptions = self._extract_image_descriptions(page, describer)
                    if descriptions:
                        images_by_page[page_num] = descriptions
                        log.debug("[pdf] page %d — added %d image descriptions", page_num, len(descriptions))

                # BUG-024: scanned/image-only page — no text extracted
                if not lines_by_page[page_num] and page_num not in images_by_page:
                    log.info("[pdf] page %d produced no text (scanned or image-only)", page_num)

        if self.detect_headings:
            sections = self._build_sections(lines_by_page, images_by_page)
            if sections:
                return sections

        return self._build_pages(lines_by_page, images_by_page)

    # ------------------------------------------------------------------ text

    def _read_lines(self, page, page_number: int) -> list[_Line]:
        """Pull out every text line on the page along with its font size."""
        lines: list[_Line] = []

        # sort=True gives blocks top-to-bottom in reading order. Without it we
        # get the order they happen to sit in the PDF content stream, which for
        # two-column papers interleaves the columns.
        data = page.get_text("dict", sort=True)

        for block in data.get("blocks", []):
            if block.get("type") != 0:  # 0 = text block, 1 = image block
                continue
            for raw_line in block.get("lines", []):
                spans = raw_line.get("spans", [])
                text = "".join(s.get("text", "") for s in spans).strip()
                if not text:
                    continue

                sizes = [s.get("size", 0.0) for s in spans]
                # PyMuPDF packs style into a bit field on each span; bit 4
                # (value 16) means bold. A heading is bold in *all* its spans —
                # a paragraph with one bold word in it is not a heading.
                is_bold = all(bool(s.get("flags", 0) & 16) for s in spans)

                lines.append(_Line(
                    text=text,
                    page_number=page_number,
                    font_size=max(sizes) if sizes else 0.0,
                    is_bold=is_bold,
                ))

        return lines

    # -------------------------------------------------------------- headings

    def _body_font_size(self, lines: list[_Line]) -> float:
        """The size most *characters* are drawn in — that's the body text.

        Weighting by characters and not by line count matters: a title page has
        few body lines and several large ones, so counting lines would decide
        that 20pt is "normal" and then find no headings at all.
        """
        char_count_per_size: Counter[float] = Counter()
        for line in lines:
            char_count_per_size[round(line.font_size, 1)] += len(line.text)

        if not char_count_per_size:
            return 0.0
        return char_count_per_size.most_common(1)[0][0]

    def _is_heading(self, line: _Line, body_size: float) -> bool:
        if body_size <= 0 or not line.text:
            return False

        # Too long to be a heading.
        if len(line.text) > self._MAX_HEADING_CHARS:
            return False

        # Page numbers and running headers like "4" or "· 12 ·".
        if sum(c.isalpha() for c in line.text) < 3:
            return False

        # A real sentence ending in a full stop is body text. We allow short ones
        # so that numbered headings written as "1. Introduction." still count.
        if line.text.endswith(".") and len(line.text.split()) > 6:
            return False

        # Clearly bigger than body text.
        if line.font_size >= body_size * self._HEADING_SIZE_RATIO:
            return True

        # Same size but bold — how most papers render "3.1 Training Setup".
        return line.is_bold and line.font_size >= body_size

    def _build_sections(
        self,
        lines_by_page: dict[int, list[_Line]],
        images_by_page: dict[int, list[str]],
    ) -> list[ParsedPage]:
        """Group lines into sections, starting a new one at every heading.

        Returns [] if the PDF has no usable heading structure, which tells
        parse() to fall back to per-page output.
        """
        all_lines = [line for page in sorted(lines_by_page) for line in lines_by_page[page]]
        body_size = self._body_font_size(all_lines)

        heading_count = sum(1 for line in all_lines if self._is_heading(line, body_size))
        if heading_count < self._MIN_HEADINGS:
            log.info(
                "[pdf] only %d heading(s) found (body font %.1fpt) — falling back to per-page parsing",
                heading_count, body_size,
            )
            return []

        sections: list[ParsedPage] = []
        buffer: list[str] = []
        # Page where the open section started — that's what we cite.
        start_page: int | None = None
        # A title that wraps onto a second line produces two heading lines in a
        # row. Those belong to the same heading, so we only break on the first.
        previous_was_heading = False

        def close_section() -> None:
            nonlocal buffer, start_page
            text = "\n".join(buffer).strip()
            if text:
                sections.append(ParsedPage(text=text, page_number=start_page))
            buffer = []
            start_page = None

        for page_number in sorted(lines_by_page):
            for line in lines_by_page[page_number]:
                is_heading = self._is_heading(line, body_size)

                if is_heading and not previous_was_heading:
                    close_section()  # the heading ends whatever came before it
                elif start_page is not None and line.page_number - start_page >= self._MAX_SECTION_PAGE_SPAN:
                    close_section()  # too long to keep one page number honest

                previous_was_heading = is_heading

                if start_page is None:
                    start_page = line.page_number
                buffer.append(line.text)

            # Figures belong to a physical page, not a section, so attach their
            # descriptions to whichever section happens to be open when the page
            # ends. Not perfect, but it keeps the figure near its discussion.
            for description in images_by_page.get(page_number, []):
                if start_page is None:
                    start_page = page_number
                buffer.append(description)

        close_section()

        log.info(
            "[pdf] split into %d sections from %d headings (body font %.1fpt)",
            len(sections), heading_count, body_size,
        )
        return sections

    def _build_pages(
        self,
        lines_by_page: dict[int, list[_Line]],
        images_by_page: dict[int, list[str]],
    ) -> list[ParsedPage]:
        """Old behaviour: one ParsedPage per physical page."""
        pages: list[ParsedPage] = []
        for page_number in sorted(lines_by_page):
            parts = [line.text for line in lines_by_page[page_number]]
            parts.extend(images_by_page.get(page_number, []))
            text = "\n".join(parts).strip()
            if text:
                pages.append(ParsedPage(text=text, page_number=page_number))
        return pages

    # ---------------------------------------------------------------- images

    def _extract_image_descriptions(self, page, describer) -> list[str]:
        descriptions = []
        images = page.get_images(full=True)
        if len(images) > self._MAX_IMAGES_PER_PAGE:
            log.info("[pdf] page has %d images — processing first %d only", len(images), self._MAX_IMAGES_PER_PAGE)
            images = images[: self._MAX_IMAGES_PER_PAGE]

        for img_info in images:
            xref = img_info[0]
            try:
                base_image = page.parent.extract_image(xref)
                image_bytes = base_image["image"]
                # BUG-002: pass real extension so describer uses correct MIME type
                image_ext = base_image.get("ext", "png")
                desc = describer(image_bytes, image_ext)
                if desc:
                    descriptions.append(f"[Figure: {desc}]")
            except Exception as exc:
                log.debug("[pdf] image extraction failed for xref=%d: %s", xref, exc)
        return descriptions
