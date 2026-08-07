from langchain_text_splitters import RecursiveCharacterTextSplitter

from backend.ingestion.chunking.base import BaseChunker, TextChunk
from backend.ingestion.parsers.base import ParsedPage


class HeadingChunker(BaseChunker):
    """For section-shaped input: each incoming ParsedPage is already one logical
    section (DOCXParser splits on Word heading styles, PDFParser on font size).

    A section that fits inside max_chunk_size becomes exactly one chunk, so its
    boundaries survive. Only oversized sections get split further, and that split
    never crosses into the next section."""

    def __init__(self, max_chunk_size: int = 800, chunk_overlap: int = 100):
        self.max_chunk_size = max_chunk_size
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=max_chunk_size,
            chunk_overlap=chunk_overlap,
        )

    def chunk(self, pages: list[ParsedPage]) -> list[TextChunk]:
        chunks: list[TextChunk] = []
        index = 0
        for page in pages:
            text = page.text.strip()
            if not text:
                continue
            if len(text) <= self.max_chunk_size:
                chunks.append(self._make_chunk(text, index, page.page_number))
                index += 1
            else:
                for split in self.splitter.split_text(text):
                    if split.strip():
                        chunks.append(self._make_chunk(split.strip(), index, page.page_number))
                        index += 1
        return chunks
