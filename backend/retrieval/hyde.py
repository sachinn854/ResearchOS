import logging

from groq import Groq

from backend.core.config import settings

log = logging.getLogger("researchos.retrieval.hyde")

_groq = Groq(api_key=settings.groq_api_key)

_SYSTEM = (
    "You are a scientific research assistant. "
    "Write a concise, factual paragraph (4-6 sentences) that directly answers the question. "
    "Write as if you are a passage from an academic paper — no preamble, no 'I think', just the answer."
)


def generate_hypothetical_document(query: str) -> str:
    """Generate a hypothetical answer passage for the query (HyDE technique).

    The returned text is embedded instead of the raw query, which puts the
    search vector in the same semantic space as real document chunks.
    """
    log.info("[hyde] generating hypothetical document for query=%r", query[:80])

    response = _groq.chat.completions.create(
        model=settings.groq_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": query},
        ],
        temperature=0.5,
        max_tokens=256,
    )

    hyp_doc = response.choices[0].message.content.strip()
    log.info("[hyde] generated %d chars", len(hyp_doc))
    log.debug("[hyde] hypothetical doc: %s", hyp_doc[:200])
    return hyp_doc
