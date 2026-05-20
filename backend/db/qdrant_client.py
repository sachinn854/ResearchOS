from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from backend.core.config import settings


client = QdrantClient(url=settings.qdrant_url)


def init_collection():
    """Create the Qdrant collection on startup if it does not already exist."""
    existing = [c.name for c in client.get_collections().collections]

    if settings.qdrant_collection not in existing:
        client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(
                size=settings.embedding_dimension,
                distance=Distance.COSINE,
            ),
        )
        print(f"Created collection: {settings.qdrant_collection}")
    else:
        print(f"Collection already exists: {settings.qdrant_collection}")
