import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.ext.asyncio import AsyncSession

from backend.retrieval.dense_retriever import DenseRetriever, RetrievedChunk
from backend.retrieval.sparse_retriever import SparseRetriever
from backend.retrieval.hyde import generate_hypothetical_document
from backend.retrieval.graph_expander import retrieve_by_entities

log = logging.getLogger("researchos.retrieval.hybrid")

_thread_pool = ThreadPoolExecutor(max_workers=4)


def _reciprocal_rank_fusion(
    results_lists: list[list[RetrievedChunk]], k: int = 60
) -> list[RetrievedChunk]:
    scores: dict[str, float] = {}
    chunk_map: dict[str, RetrievedChunk] = {}

    for results in results_lists:
        for rank, chunk in enumerate(results):
            key = f"{chunk.document_id}_{chunk.chunk_index}"
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
            chunk_map[key] = chunk

    sorted_keys = sorted(scores, key=lambda x: scores[x], reverse=True)
    fused = [chunk_map[key] for key in sorted_keys]

    for chunk, key in zip(fused, sorted_keys):
        chunk.score = round(scores[key], 4)

    return fused


class HybridRetriever:
    def __init__(self, use_hyde: bool = True, use_graph: bool = True):
        self.dense = DenseRetriever()
        self.sparse = SparseRetriever()
        self.use_hyde = use_hyde
        self.use_graph = use_graph

    async def retrieve(
        self,
        query: str,
        db: AsyncSession,
        top_k: int = 8,
        domain: str | None = None,
    ) -> tuple[list[RetrievedChunk], float]:
        """Returns (chunks, best_dense_score).

        best_dense_score is the raw Qdrant cosine similarity of the top result
        (range 0-1). Use this for web fallback decisions — RRF scores are
        rank-based (always ~0.013-0.033) and meaningless for relevance threshold.
        """
        log.info("[hybrid] starting retrieval | hyde=%s | graph=%s | domain=%s",
                 self.use_hyde, self.use_graph, domain)

        loop = asyncio.get_event_loop()

        # Run HyDE (blocking LLM call) and sparse (async DB) concurrently
        if self.use_hyde:
            hyde_task = loop.run_in_executor(_thread_pool, generate_hypothetical_document, query)
            sparse_task = self.sparse.retrieve(query, db=db, top_k=20, domain=domain)
            dense_query, sparse_results = await asyncio.gather(hyde_task, sparse_task)
        else:
            sparse_results = await self.sparse.retrieve(query, db=db, top_k=20, domain=domain)
            dense_query = query

        # Dense runs after HyDE (needs the hypothetical doc as query)
        dense_results = await loop.run_in_executor(
            _thread_pool, self.dense.retrieve, dense_query, 20, domain
        )

        # Capture best cosine similarity BEFORE RRF overwrites scores
        best_dense_score = max((c.score for c in dense_results), default=0.0)
        log.info("[hybrid] best_dense_score=%.3f", best_dense_score)

        results_to_fuse = [dense_results, sparse_results]

        if self.use_graph:
            graph_results = await loop.run_in_executor(
                _thread_pool, retrieve_by_entities, query, 10, domain
            )
            if graph_results:
                results_to_fuse.append(graph_results)
                log.info("[hybrid] graph=%d chunks added", len(graph_results))

        fused = _reciprocal_rank_fusion(results_to_fuse)
        final = fused[:top_k]

        log.info("[hybrid] final %d chunks ready | best_dense=%.3f", len(final), best_dense_score)
        return final, best_dense_score
