import logging
import threading

from fastembed import TextEmbedding

from backend.core.config import settings

log = logging.getLogger("researchos.ingestion.embedding")


class EmbeddingService:
    def __init__(self):
        log.info("[embedding] loading model: %s", settings.embedding_model)
        self.model = TextEmbedding(model_name=settings.embedding_model)
        log.info("[embedding] model ready")

    def embed(self, texts: list[str]) -> list[list[float]]:
        log.info("[embedding] embedding %d texts...", len(texts))
        vectors = list(self.model.embed(texts))
        log.info("[embedding] done | count=%d", len(vectors))
        return [v.tolist() for v in vectors]

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


# The single embedding model this process uses. Built on first use, never at import.
_shared_embedder: EmbeddingService | None = None
_embedder_lock = threading.Lock()


def get_embedder() -> EmbeddingService:
    """Return the process-wide embedding model, loading it on first use.

    This replaced four separate `EmbeddingService()` calls, and it fixes two
    distinct problems that together broke the deployment:

    1. Duplicate weights. Every call site built its own copy of the same model.
       An API process ended up holding three (graph_expander, plus one per
       HybridRetriever in the routes module) — measured at ~120 MB each, so
       ~240 MB was spent on copies that were byte-for-byte identical.

    2. Loading during import. Those calls sat at module level, so the model had
       to load before uvicorn could bind a port. On a cold container that also
       means downloading the model from HuggingFace first. If that download is
       slow or fails, the platform proxy has nothing to route to: every request
       returns 502 and nothing shows up in the application log, because the
       application is not listening yet. Same failure shape as the alembic hang
       we already fixed in the Dockerfile — work on the startup path that is
       allowed to block forever.

    Lazy plus shared fixes both: one copy, created the first time something
    actually embeds, which is after the port is open.

    The lock is needed because retrieval runs its three signals inside a
    ThreadPoolExecutor. Without it two threads arriving at a cold cache would
    each build a model, which is the duplication problem again.
    """
    global _shared_embedder

    if _shared_embedder is None:
        with _embedder_lock:
            # Re-check inside the lock: another thread may have built it while
            # this one waited.
            if _shared_embedder is None:
                _shared_embedder = EmbeddingService()

    return _shared_embedder
