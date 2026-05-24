import logging

from sqlalchemy.ext.asyncio import AsyncSession

from backend.retrieval.dense_retriever import DenseRetriever, RetrievedChunk
from backend.retrieval.sparse_retriever import SparseRetriever
from backend.retrieval.reranker import Reranker
from backend.retrieval.hyde import generate_hypothetical_document
from backend.retrieval.graph_expander import retrieve_by_entities

log = logging.getLogger("researchos.retrieval.hybrid")


def _reciprocal_rank_fusion(
    results_lists: list[list[RetrievedChunk]], k: int = 60
) -> list[RetrievedChunk]:
    """Combine multiple ranked lists into one using Reciprocal Rank Fusion."""
    scores: dict[str, float] = {}
    chunk_map: dict[str, RetrievedChunk] = {}

    for results in results_lists:
        for rank, chunk in enumerate(results):
            key = f"{chunk.document_id}_{chunk.chunk_index}"
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
            chunk_map[key] = chunk

    sorted_keys = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [chunk_map[key] for key in sorted_keys]


class HybridRetriever:
    def __init__(self, use_hyde: bool = True, use_graph: bool = True):
        self.dense = DenseRetriever()
        self.sparse = SparseRetriever()
        self.reranker = Reranker()
        self.use_hyde = use_hyde
        self.use_graph = use_graph

    async def retrieve(
        self,
        query: str,
        db: AsyncSession,
        top_k: int = 5,
        domain: str | None = None,
    ) -> list[RetrievedChunk]:
        """Dense + sparse + graph retrieval fused with RRF, then reranked.

        - Dense uses HyDE (hypothetical document embedding)
        - Sparse uses original query (keyword matching)
        - Graph uses entity overlap matching
        """
        log.info("[hybrid] starting retrieval | query=%r | hyde=%s | graph=%s | domain=%s",
                 query[:60], self.use_hyde, self.use_graph, domain)

        dense_query = query
        if self.use_hyde:
            dense_query = generate_hypothetical_document(query)

        dense_results = self.dense.retrieve(dense_query, top_k=20, domain=domain)
        sparse_results = await self.sparse.retrieve(query, db=db, top_k=20, domain=domain)

        results_to_fuse = [dense_results, sparse_results]

        if self.use_graph:
            graph_results = retrieve_by_entities(query, top_k=10, domain=domain)
            if graph_results:
                results_to_fuse.append(graph_results)
                log.info("[hybrid] graph=%d chunks added to fusion pool", len(graph_results))

        log.info("[hybrid] dense=%d | sparse=%d — fusing with RRF...",
                 len(dense_results), len(sparse_results))
        fused = _reciprocal_rank_fusion(results_to_fuse)
        log.info("[hybrid] fused=%d unique chunks", len(fused))

        final = self.reranker.rerank(query, chunks=fused[:20], top_k=top_k)

        # Confidence threshold — drop results if best score is too low
        if final and final[0].score < 0.65:
            log.info("[hybrid] low confidence (top score=%.3f < 0.65) — returning empty", final[0].score)
            return []

        log.info("[hybrid] final top_%d chunks ready", len(final))
        return final
