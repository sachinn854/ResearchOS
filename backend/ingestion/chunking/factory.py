from backend.ingestion.chunking.base import BaseChunker
from backend.ingestion.chunking.recursive_chunker import RecursiveChunker
from backend.ingestion.chunking.heading_chunker import HeadingChunker
from backend.ingestion.chunking.markdown_chunker import MarkdownChunker
from backend.ingestion.chunking.semantic_chunker import SemanticChunker


def get_chunker(doc_type: str) -> BaseChunker:
    """Return the appropriate chunker for the given document type."""
    match doc_type:
        # BUG-021: PDFs used to land on RecursiveChunker, which splits on raw
        # character count and happily produced chunks that started in "Results"
        # and ended in "Discussion". PDFParser now detects headings and returns
        # one ParsedPage per section, so HeadingChunker splits only *inside* a
        # section. If a PDF has no detectable headings, PDFParser falls back to
        # per-page output and HeadingChunker handles that fine too.
        case "pdf" | "docx":
            return HeadingChunker()
        case "txt":
            return RecursiveChunker()
        case "md":
            return MarkdownChunker()
        case "web":
            # BUG-031: SemanticChunker was a no-op wrapper around RecursiveChunker
            return RecursiveChunker()
        case _:
            return RecursiveChunker()
