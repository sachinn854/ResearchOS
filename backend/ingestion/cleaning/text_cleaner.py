import logging
import re

log = logging.getLogger("researchos.ingestion.cleaning")

# ── Compiled patterns ────────────────────────────────────────────────────────

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}")
_DOI = re.compile(r"doi:\s*10\.\d{4,}", re.IGNORECASE)
_ARXIV_ID = re.compile(r"arXiv:\s*\d{4}\.\d{4,5}", re.IGNORECASE)
_COPYRIGHT = re.compile(r"(©|\bcopyright\b|\ball rights reserved\b)", re.IGNORECASE)
_ACM_IEEE = re.compile(r"\b(ACM|IEEE|Springer|Elsevier)\b.*\d{4}", re.IGNORECASE)
_PAGE_NUMBER = re.compile(r"^\s*-?\s*\d+\s*-?\s*$")
_REFERENCE_LINE = re.compile(r"^\s*\[\d+\]")
_ORCID = re.compile(r"orcid\.org", re.IGNORECASE)
_URL_ONLY_LINE = re.compile(r"^\s*https?://\S+\s*$")

# Section headings that signal non-content (truncate everything after these).
# BUG-019: "appendix" removed — appendix content is often valuable and "See Appendix"
# mid-paragraph would have caused premature truncation.
_NOISE_SECTION_HEADING = re.compile(
    r"^(references|bibliography|acknowledgments?|acknowledgements?|"
    r"about the authors?|author contributions?|funding|competing interests?|"
    r"conflict of interest)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


# ── Page-level cleaner ───────────────────────────────────────────────────────

def clean_page_text(text: str) -> str:
    """Clean a full page of text before chunking.

    - Truncates at references / acknowledgments / bibliography headings
    - Removes email lines, DOI lines, copyright lines, page numbers
    """
    # Truncate at noise section headings
    match = _NOISE_SECTION_HEADING.search(text)
    if match:
        text = text[: match.start()].strip()
        log.debug("truncated at noise section heading at char %d", match.start())

    lines = text.splitlines()
    kept = []
    for line in lines:
        stripped = line.strip()

        if not stripped:
            kept.append(line)
            continue
        if _EMAIL.search(stripped):
            continue
        if _DOI.search(stripped):
            continue
        if _ARXIV_ID.search(stripped):
            continue
        if _COPYRIGHT.search(stripped):
            continue
        if _ACM_IEEE.search(stripped):
            continue
        if _PAGE_NUMBER.match(stripped):
            continue
        if _ORCID.search(stripped):
            continue
        if _URL_ONLY_LINE.match(stripped):
            continue

        kept.append(line)

    return "\n".join(kept).strip()


# ── Chunk-level filter ───────────────────────────────────────────────────────

def is_clean_chunk(text: str, min_words: int = 30) -> bool:
    """Return True if a chunk is worth embedding.

    Drops chunks that are:
    - Too short (headers, footers, lone titles)
    - Reference list entries  ([1] Lewis et al...)
    - Contain emails or DOIs
    - Have very low alphabetic content (tables of numbers, metadata)
    """
    words = text.split()

    if len(words) < min_words:
        log.debug("drop — too short (%d words)", len(words))
        return False

    # Count lines that look like reference entries
    ref_lines = sum(1 for line in text.splitlines() if _REFERENCE_LINE.match(line))
    if ref_lines >= 3:
        log.debug("drop — reference section (%d ref lines)", ref_lines)
        return False

    if _EMAIL.search(text):
        log.debug("drop — contains email")
        return False

    # BUG-020: was _DOI.search(text) — that dropped chunks with inline DOI citations
    # (e.g. "This work extends [25] (doi:10.1145/...)"). Now only drop chunks where
    # the majority of lines are DOI-only lines (pure reference sections).
    doi_lines = sum(1 for line in text.splitlines() if _DOI.search(line.strip()) and len(line.strip()) < 80)
    total_lines = max(len(text.splitlines()), 1)
    if doi_lines / total_lines > 0.5:
        log.debug("drop — majority DOI lines (%d/%d)", doi_lines, total_lines)
        return False

    # Alphabetic ratio — pure number tables / metadata score very low
    alpha_ratio = sum(c.isalpha() for c in text) / max(len(text), 1)
    if alpha_ratio < 0.45:
        log.debug("drop — low alpha ratio (%.2f)", alpha_ratio)
        return False

    return True
