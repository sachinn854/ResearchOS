import logging

from sentence_transformers import SentenceTransformer

from backend.core.config import settings

log = logging.getLogger("researchos.ingestion.embedding")


class EmbeddingService:
    def __init__(self):
        log.info("[embedding] loading model: %s", settings.embedding_model)
        self.model = SentenceTransformer(settings.embedding_model)
        log.info("[embedding] model ready")

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts and return their vectors."""
        log.info("[embedding] embedding %d texts...", len(texts))
        vectors = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        log.info("[embedding] done | shape=(%d, %d)", len(vectors), len(vectors[0]))
        return vectors.tolist()

    def embed_one(self, text: str) -> list[float]:
        """Embed a single text string."""
        return self.embed([text])[0]
