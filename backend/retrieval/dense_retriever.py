import logging
from dataclasses import dataclass

from qdrant_client.models import Filter, FieldCondition, MatchValue

from backend.core.config import settings
from backend.db.qdrant_client import client as qdrant_client
from backend.ingestion.embedding.embedding_service import get_embedder

log = logging.getLogger("researchos.retrieval.dense")


@dataclass
class RetrievedChunk:
    text: str
    document_id: str
    chunk_index: int
    page_number: int | None
    score: float
    domain: str | None


class DenseRetriever:
    # No __init__ on purpose. It used to build its own EmbeddingService, which
    # meant constructing a retriever loaded a model — and the routes module
    # constructs two retrievers at import time, before uvicorn opens the port.
    # The model is fetched per call instead; get_embedder() hands back the same
    # shared instance every time, so this costs nothing after the first query.

    def retrieve(self, query: str, top_k: int = 5, domain: str | None = None) -> list[RetrievedChunk]:
        """Embed the query and search Qdrant for the most similar chunks."""
        log.info("[dense] embedding query...")
        vector = get_embedder().embed_one(query)

        query_filter = None
        if domain:
            query_filter = Filter(
                must=[FieldCondition(key="domain", match=MatchValue(value=domain))]
            )

        log.info("[dense] searching Qdrant | top_k=%d | domain=%s", top_k, domain)
        results = qdrant_client.query_points(
            collection_name=settings.qdrant_collection,
            query=vector,
            limit=top_k,
            query_filter=query_filter,
            with_payload=True,
        ).points

        log.info("[dense] found %d results", len(results))
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
