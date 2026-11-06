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
    """Create the Qdrant collection on startup if it does not already exist.

    Also ensures keyword indexes exist for filtered fields (domain, entities,
    document_id) so filtered queries don't 400 with "Index required but not
    found". Ref: Chatbot backend/rag/store.py _ensure_payload_indexes.
    """
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
        _ensure_payload_indexes()
    else:
        print(f"Collection already exists: {settings.qdrant_collection}")
        _ensure_payload_indexes()


def _ensure_payload_indexes() -> None:
    """Create keyword indexes for filtered fields (idempotent)."""
    for field in ("domain", "document_id", "entities"):
        try:
            client.create_payload_index(
                collection_name=settings.qdrant_collection,
                field_name=field,
                field_schema="keyword",
            )
            print(f"Created keyword index: {field}")
        except Exception:
            pass  # already exists
