from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from backend.core.config import settings


# timeout: the client defaults to 5s, which is not enough to upsert a few hundred
# vectors to Qdrant Cloud over the public internet. A large paper would fail with
# "The write operation timed out" and the pipeline marked the whole document
# failed — after its chunks were already committed to Postgres, leaving text in
# the sparse index with no vector in the dense one.
client = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=120)


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
