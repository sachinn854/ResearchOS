import logging

from backend.core.config import settings
from backend.core.llm import llm as _llm, provider_kwargs

log = logging.getLogger("researchos.retrieval.hyde")

_SYSTEM = (
    "Write 2-3 sentences that directly answer this question as if from an academic paper. "
    "Be factual and concise. No preamble."
)


def generate_hypothetical_document(query: str) -> str:
    log.info("[hyde] generating hypothetical document for query=%r", query[:80])

    response = _llm.chat.completions.create(**provider_kwargs(),
        model=settings.fast_llm_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": query},
        ],
        temperature=0.3,
        max_tokens=120,
    )

    # `fast_llm_model` is a `:free` OpenRouter model, and a free model under load returns
    # a well-formed response whose `content` is None rather than an error. Calling .strip()
    # on that took down eight of ten queries in a burst, because HyDE runs before dense
    # retrieval and the exception escaped the whole request. Falling back to the raw query
    # costs recall on that one call; raising costs the entire answer.
    content = response.choices[0].message.content
    if not content or not content.strip():
        log.warning("[hyde] model returned no content  - falling back to the raw query")
        return query

    hyp_doc = content.strip()
    log.info("[hyde] generated %d chars", len(hyp_doc))
    return hyp_doc
