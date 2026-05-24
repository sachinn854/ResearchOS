import logging

from sentence_transformers import CrossEncoder

from backend.retrieval.dense_retriever import RetrievedChunk

log = logging.getLogger("researchos.retrieval.reranker")


class Reranker:
    def __init__(self):
        log.info("[reranker] loading CrossEncoder model...")
        self.model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        log.info("[reranker] model ready")

    def rerank(self, query: str, chunks: list[RetrievedChunk], top_k: int = 5) -> list[RetrievedChunk]:
        """Score each (query, chunk) pair and return the top_k most relevant chunks."""
        if not chunks:
            return []

        log.info("[reranker] scoring %d chunks...", len(chunks))
        pairs = [(query, chunk.text) for chunk in chunks]
        scores = self.model.predict(pairs)

        scored = sorted(zip(scores, chunks), key=lambda x: x[0], reverse=True)
        top = [chunk for _, chunk in scored[:top_k]]

        log.info("[reranker] top %d chunks selected | scores: %s",
                 top_k, [round(float(s), 4) for s, _ in sorted(zip(scores, chunks), key=lambda x: x[0], reverse=True)[:top_k]])
        return top
