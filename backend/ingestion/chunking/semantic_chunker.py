from langchain_experimental.text_splitter import SemanticChunker as LangChainSemanticChunker
from langchain_huggingface import HuggingFaceEmbeddings

from backend.ingestion.chunking.base import BaseChunker, TextChunk
from backend.ingestion.parsers.base import ParsedPage
from backend.core.config import settings


class SemanticChunker(BaseChunker):
    """Splits text at semantic boundaries using embedding similarity.
    Best suited for web content where structure is unpredictable."""

    def __init__(self):
        embeddings = HuggingFaceEmbeddings(model_name=settings.embedding_model)
        self.splitter = LangChainSemanticChunker(
            embeddings=embeddings,
            breakpoint_threshold_type="percentile",
            breakpoint_threshold_amount=95,
        )

    def chunk(self, pages: list[ParsedPage]) -> list[TextChunk]:
        full_text = "\n\n".join(p.text for p in pages)
        splits = self.splitter.split_text(full_text)
        return [
            self._make_chunk(s.strip(), i, None)
            for i, s in enumerate(splits)
            if s.strip()
        ]
