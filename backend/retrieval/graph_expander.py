import json
import logging

from qdrant_client.models import FieldCondition, Filter, MatchAny

from backend.core.config import settings
from backend.db.qdrant_client import client as qdrant_client
from backend.ingestion.embedding.embedding_service import EmbeddingService
from backend.retrieval.dense_retriever import RetrievedChunk

log = logging.getLogger("researchos.retrieval.graph")

_embedder = EmbeddingService()

_SYSTEM = """Extract key technical entities from this search query.
Return JSON: {"entities": ["entity1", "entity2"]}
Lowercase, max 5 entities, specific technical terms only.
Return ONLY JSON."""


def _extract_query_entities(query: str) -> list[str]:
    from groq import Groq
    from backend.core.config import settings as _s

    groq = Groq(api_key=_s.groq_api_key)
    try:
        response = groq.chat.completions.create(
            model=_s.groq_model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": query},
            ],
            temperature=0,
            max_tokens=80,
        )
        data = json.loads(response.choices[0].message.content)
        return [e.lower().strip() for e in data.get("entities", []) if e.strip()][:5]
    except Exception:
        return []


def retrieve_by_entities(
    query: str,
    top_k: int = 10,
    domain: str | None = None,
) -> list[RetrievedChunk]:
    """Find chunks whose entity lists overlap with the query's entities.

    Stores entities in Qdrant payload as a list field.
    Returns empty list if no entities extracted or none found.
    """
    entities = _extract_query_entities(query)
    if not entities:
        log.info("[graph] no entities extracted — skipping entity retrieval")
        return []

    log.info("[graph] query entities: %s", entities)

    must = [FieldCondition(key="entities", match=MatchAny(any=entities))]
    if domain:
        must.append(FieldCondition(key="domain", match=MatchAny(any=[domain])))

    vector = _embedder.embed_one(query)

    results = qdrant_client.query_points(
        collection_name=settings.qdrant_collection,
        query=vector,
        query_filter=Filter(must=must),
        limit=top_k,
        with_payload=True,
    ).points

    log.info("[graph] entity search returned %d chunks", len(results))
    return [
        RetrievedChunk(
            text=r.payload["text"],
            document_id=r.payload.get("document_id", ""),
            chunk_index=r.payload.get("chunk_index", 0),
            page_number=r.payload.get("page_number"),
            score=r.score,
            domain=r.payload.get("domain"),
        )
        for r in results
    ]
