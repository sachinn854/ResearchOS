"""Tests for PDF heading detection (BUG-021).

PDFs are built on the fly with PyMuPDF, so there is no fixture file to keep in
sync. Body text is drawn at 10pt, headings at 16pt — the same signal the parser
looks for in a real paper.
"""
import os
import tempfile

import fitz
import pytest

from backend.ingestion.chunking.factory import get_chunker
from backend.ingestion.chunking.heading_chunker import HeadingChunker
from backend.ingestion.parsers.pdf_parser import PDFParser

BODY_SIZE = 10
HEADING_SIZE = 16


def _write_pdf(pages: list[list[tuple[str, int]]]) -> str:
    """pages = [[(text, fontsize), ...], ...] — one inner list per page."""
    doc = fitz.open()
    for lines in pages:
        page = doc.new_page()
        y = 60
        for text, size in lines:
            page.insert_text((60, y), text, fontsize=size)
            y += size + 8
    handle, path = tempfile.mkstemp(suffix=".pdf")
    os.close(handle)
    doc.save(path)
    doc.close()
    return path


def _parse(pages, **kwargs):
    path = _write_pdf(pages)
    try:
        return PDFParser(extract_images=False, **kwargs).parse(path)
    finally:
        os.unlink(path)


def _body(text: str, times: int = 6) -> list[tuple[str, int]]:
    return [(f"{text} sentence {i} with enough words to look like prose.", BODY_SIZE)
            for i in range(times)]


def test_headings_start_new_sections():
    sections = _parse([
        [("Introduction", HEADING_SIZE), *_body("intro"),
         ("Method", HEADING_SIZE), *_body("method")],
    ])

    assert len(sections) == 2
    assert sections[0].text.startswith("Introduction")
    assert sections[1].text.startswith("Method")
    # The whole point of BUG-021: no section carries both headings' content.
    assert "Method" not in sections[0].text


def test_wrapped_heading_stays_one_section():
    """A title long enough to wrap produces two consecutive heading lines. They
    are one heading, not two sections."""
    sections = _parse([
        [("A Very Long Paper Title That", HEADING_SIZE),
         ("Wraps Onto A Second Line", HEADING_SIZE),
         *_body("abstract"),
         ("Introduction", HEADING_SIZE), *_body("intro")],
    ])

    assert len(sections) == 2
    assert "Wraps Onto A Second Line" in sections[0].text


def test_falls_back_to_pages_without_headings():
    """No heading anywhere — keep per-page output so page numbers survive."""
    sections = _parse([_body("page one"), _body("page two"), _body("page three")])

    assert [s.page_number for s in sections] == [1, 2, 3]


def test_section_never_spans_pages_so_citations_stay_exact():
    """A section carries one page number that every chunk inherits. If sections
    were allowed to run across pages, chunks from page 3 would be cited as
    page 1."""
    sections = _parse([
        [("Introduction", HEADING_SIZE), *_body("intro")],
        _body("continued"),
        _body("still going"),
        [("Conclusion", HEADING_SIZE), *_body("conclusion")],
    ])

    pages_seen = {s.page_number for s in sections}
    assert pages_seen == {1, 2, 3, 4}, f"lost page attribution: {pages_seen}"


def test_page_numbers_are_one_based():
    sections = _parse([[("Introduction", HEADING_SIZE), *_body("intro")]])
    assert sections[0].page_number == 1


def test_page_numbers_are_never_wrong_after_chunking():
    """End to end: parse -> chunk. Every chunk must claim a page that exists."""
    pages = [
        [("Introduction", HEADING_SIZE), *_body("intro", 12)],
        [("Method", HEADING_SIZE), *_body("method", 12)],
        [("Results", HEADING_SIZE), *_body("results", 12)],
    ]
    sections = _parse(pages)
    chunks = get_chunker("pdf").chunk(sections)

    assert chunks
    assert {c.page_number for c in chunks} <= {1, 2, 3}
    # All three pages should be represented, not collapsed onto page 1.
    assert {c.page_number for c in chunks} == {1, 2, 3}


def test_pdf_routes_to_heading_chunker():
    assert isinstance(get_chunker("pdf"), HeadingChunker)


def test_detection_can_be_turned_off():
    pages = [[("Introduction", HEADING_SIZE), *_body("intro"),
              ("Method", HEADING_SIZE), *_body("method")]]

    with_detection = _parse(pages, detect_headings=True)
    without = _parse(pages, detect_headings=False)

    assert len(with_detection) == 2      # split on the two headings
    assert len(without) == 1             # one physical page, one ParsedPage


def test_short_section_fits_in_one_chunk():
    """A section under the chunk size must survive whole — that is what keeps a
    chunk from straddling two sections."""
    sections = _parse([
        [("Introduction", HEADING_SIZE), ("A short intro paragraph.", BODY_SIZE),
         ("Method", HEADING_SIZE), ("A short method paragraph.", BODY_SIZE)],
    ])
    chunks = HeadingChunker(max_chunk_size=800).chunk(sections)

    assert len(chunks) == 2
    assert "Method" not in chunks[0].text
