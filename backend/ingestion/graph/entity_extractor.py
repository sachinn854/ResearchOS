import json
import logging

from groq import Groq

from backend.core.config import settings

log = logging.getLogger("researchos.ingestion.graph")

_groq = Groq(api_key=settings.groq_api_key)

_SYSTEM = """Extract key technical entities from the text.
Return a JSON object: {"entities": ["entity1", "entity2", ...]}
Rules:
- Specific concepts, methods, models, datasets, algorithms, or metrics only
- Lowercase, 1-4 words max
- Max 10 entities
- No generic words like "paper", "study", "result"
Return ONLY the JSON object."""


def extract_entities(text: str) -> list[str]:
    """Extract technical entities from a chunk of text using the LLM.

    Returns a list of lowercase entity strings (max 10).
    Returns [] on any failure so the pipeline is never blocked.
    """
    try:
        response = _groq.chat.completions.create(
            model=settings.groq_model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": text[:800]},
            ],
            temperature=0,
            max_tokens=120,
        )
        data = json.loads(response.choices[0].message.content)
        entities = [e.lower().strip() for e in data.get("entities", []) if e.strip()]
        log.debug("[graph] extracted %d entities: %s", len(entities), entities)
        return entities[:10]
    except Exception as exc:
        log.debug("[graph] entity extraction failed: %s", exc)
        return []
