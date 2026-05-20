from dataclasses import dataclass

from qdrant_client.models import Filter, FieldCondition, MatchValue

from backend.core.config import settings
from backend.db.qdrant_client import client as qdrant_client
from backend.ingestion.embedding.embedding_service import EmbeddingService


@dataclass
class RetrievedChunk:
    text: str
    document_id: str
    chunk_index: int
    page_number: int | None
    score: float
    domain: str | None


class DenseRetriever:
    def __init__(self):
        self.embedder = EmbeddingService()

    def retrieve(self, query: str, top_k: int = 5, domain: str | None = None) -> list[RetrievedChunk]:
        """Embed the query and search Qdrant for the most similar chunks."""
        vector = self.embedder.embed_one(query)

        query_filter = None
        if domain:
            query_filter = Filter(
                must=[FieldCondition(key="domain", match=MatchValue(value=domain))]
            )

        results = qdrant_client.search(
            collection_name=settings.qdrant_collection,
            query_vector=vector,
            limit=top_k,
            query_filter=query_filter,
            with_payload=True,
        )

        return [
            RetrievedChunk(
                text=r.payload["text"],
                document_id=r.payload["document_id"],
                chunk_index=r.payload["chunk_index"],
                page_number=r.payload.get("page_number"),
                score=r.score,
                domain=r.payload.get("domain"),
            )
            for r in results
        ]
