"""Pulls technical entities out of chunks so graph retrieval has something to
match on.

BUG-014: this used to be one LLM call per chunk, made synchronously from inside
an `async def`. Two separate problems came from that:

  1. **Latency.** A 130-chunk paper meant 130 calls one after another. At ~1s
     each that is over two minutes of pure waiting per document.
  2. **The event loop froze.** The OpenAI client is synchronous. Calling it from
     a coroutine without `to_thread` blocks the whole loop, so for those two
     minutes the API server could not answer *any* other request.

The fix is two changes:
  - **Batch** — ask about several chunks in one call (130 calls → 26).
  - **Overlap, off-loop** — run a few batches at once inside worker threads, so
    26 calls take about 7 rounds and the event loop stays free.
"""
import asyncio
import json
import logging
import re

from backend.core.config import settings
from backend.core.llm import llm as _llm, provider_kwargs

log = logging.getLogger("researchos.ingestion.graph")

# How many chunks go into one prompt. Chunks are ~800 chars, so 5 keeps the
# prompt around 4k chars — small enough that the model still answers about every
# block instead of losing track near the end.
_BATCH_SIZE = 5
# How many of those calls run at the same time. Kept low on purpose: the free
# OpenRouter tiers rate-limit aggressively, and 429s here would cost us more
# retries than the concurrency saves.
_MAX_CONCURRENT_BATCHES = 4

_MAX_CHARS_PER_CHUNK = 800
_MAX_ENTITIES_PER_CHUNK = 10
# The prompt asks for 1-4 word entities. Anything longer came back as a sentence
# and is useless for matching, so we drop it.
_MAX_WORDS_PER_ENTITY = 4

_SYSTEM = """Extract key technical entities from the text.
Return a JSON object: {"entities": ["entity1", "entity2", ...]}
Rules:
- Specific concepts, methods, models, datasets, algorithms, or metrics only
- Lowercase, 1-4 words max
- Max 10 entities
- No generic words like "paper", "study", "result"
Return ONLY the JSON object."""

_BATCH_SYSTEM = """Extract key technical entities from each numbered text block.

Return a JSON object mapping every block number to its list of entities:
{"1": ["entity a", "entity b"], "2": ["entity c"], "3": []}

Rules:
- Specific concepts, methods, models, datasets, algorithms, or metrics only
- Lowercase, 1-4 words max
- Max 10 entities per block
- No generic words like "paper", "study", "result"
- Every block number must appear in the output, even if its list is empty
Return ONLY the JSON object."""

# Models often wrap JSON in ```json fences or add a sentence before it. Grabbing
# the outermost {...} is more forgiving than json.loads on the raw string, which
# is what the old single-chunk version did — and it failed silently.
_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json_object(raw: str | None) -> dict:
    if not raw:
        return {}
    match = _JSON_OBJECT.search(raw)
    if not match:
        return {}
    return json.loads(match.group(0))


def _clean_entities(values) -> list[str]:
    """Normalise whatever the model returned into a deduplicated entity list."""
    if not isinstance(values, list):
        return []

    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        entity = value.lower().strip()
        if not entity or len(entity.split()) > _MAX_WORDS_PER_ENTITY:
            continue
        if entity in seen:
            continue
        seen.add(entity)
        cleaned.append(entity)

    return cleaned[:_MAX_ENTITIES_PER_CHUNK]


def extract_entities(text: str) -> list[str]:
    """Entities for a single chunk — one LLM call.

    Kept for the retry path below and for callers handling one chunk. For a
    whole document use `extract_entities_for_chunks()`, which batches.
    """
    try:
        response = _llm.chat.completions.create(**provider_kwargs(),
            model=settings.fast_llm_model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": text[:_MAX_CHARS_PER_CHUNK]},
            ],
            temperature=0,
            max_tokens=120,
        )
        data = _parse_json_object(response.choices[0].message.content)
        entities = _clean_entities(data.get("entities", []))
        log.debug("[graph] extracted %d entities: %s", len(entities), entities)
        return entities
    except Exception as exc:
        log.debug("[graph] entity extraction failed: %s", exc)
        return []


def _extract_batch(texts: list[str]) -> list[list[str]]:
    """One LLM call for several chunks. Always returns one list per input text.

    Runs in a worker thread (see `extract_entities_for_chunks`), so it is written
    as ordinary blocking code.
    """
    numbered = "\n\n".join(
        f"[{position}]\n{text[:_MAX_CHARS_PER_CHUNK]}"
        for position, text in enumerate(texts, start=1)
    )

    try:
        response = _llm.chat.completions.create(**provider_kwargs(),
            model=settings.fast_llm_model,
            messages=[
                {"role": "system", "content": _BATCH_SYSTEM},
                {"role": "user", "content": numbered},
            ],
            temperature=0,
            # Budget per block: ~10 short entities plus JSON punctuation.
            max_tokens=150 * len(texts),
        )
    except Exception as exc:
        # The call itself did not land — rate limit, timeout, network. Do NOT
        # retry chunk by chunk here: on a 429 that fires _BATCH_SIZE more doomed
        # calls and digs the rate limit deeper. Drop the batch; entities are an
        # optional signal.
        log.warning("[graph] batch of %d failed on the API call (%s) — skipping it", len(texts), exc)
        return [[] for _ in texts]

    try:
        data = _parse_json_object(response.choices[0].message.content)
    except (json.JSONDecodeError, ValueError) as exc:
        # The model replied, just not with valid JSON. Here retrying one chunk at
        # a time is worth it — the single-chunk schema is much simpler than the
        # numbered-map one, so it usually succeeds.
        log.warning(
            "[graph] batch of %d returned invalid JSON (%s) — retrying one call per chunk",
            len(texts), exc,
        )
        return [extract_entities(text) for text in texts]

    results = [_clean_entities(data.get(str(position), [])) for position in range(1, len(texts) + 1)]

    # The call succeeded but produced nothing usable — almost always because the
    # model answered in a different shape (a flat list, or keys like "block 1").
    # Retrying individually is bounded to _BATCH_SIZE extra calls and beats
    # silently dropping the graph signal for these chunks.
    if len(texts) > 1 and not any(results):
        log.warning(
            "[graph] batch of %d parsed but yielded no entities — falling back to one call per chunk",
            len(texts),
        )
        return [extract_entities(text) for text in texts]

    return results


async def extract_entities_for_chunks(texts: list[str]) -> list[list[str]]:
    """Entities for every chunk of a document.

    Returns a list the same length as `texts` — index i belongs to texts[i], so
    the caller can zip it straight onto its chunks.

    Never raises. Entities only feed the graph signal in hybrid retrieval, which
    is the weakest of the three signals; losing them must not fail an ingest.
    """
    if not texts:
        return []

    if not settings.enable_entity_extraction:
        log.info(
            "[graph] entity extraction disabled — skipping %d chunks (graph retrieval will have no entities to match)",
            len(texts),
        )
        return [[] for _ in texts]

    batches = [texts[i:i + _BATCH_SIZE] for i in range(0, len(texts), _BATCH_SIZE)]
    # Without this the gather below would fire all 26 calls at once and get
    # rate-limited.
    limit = asyncio.Semaphore(_MAX_CONCURRENT_BATCHES)

    async def run_batch(batch: list[str]) -> list[list[str]]:
        async with limit:
            # to_thread is the important part: the OpenAI client is synchronous,
            # so awaiting it in a thread is what keeps the event loop responsive.
            return await asyncio.to_thread(_extract_batch, batch)

    log.info(
        "[graph] extracting entities for %d chunks — %d batches of %d, %d in flight",
        len(texts), len(batches), _BATCH_SIZE, _MAX_CONCURRENT_BATCHES,
    )

    outcomes = await asyncio.gather(
        *(run_batch(batch) for batch in batches),
        return_exceptions=True,
    )

    results: list[list[str]] = []
    for batch, outcome in zip(batches, outcomes):
        if isinstance(outcome, BaseException):
            log.warning("[graph] batch dropped: %s", outcome)
            results.extend([] for _ in batch)
        else:
            results.extend(outcome)

    # The caller zips this onto its chunk list, and zip() stops at the shorter
    # side — so a length mismatch here would silently throw chunks away instead
    # of raising. Enforce the contract rather than trusting it.
    if len(results) != len(texts):
        log.error(
            "[graph] length mismatch: %d entity lists for %d chunks — padding to keep them aligned",
            len(results), len(texts),
        )
        results = results[:len(texts)]
        results.extend([] for _ in range(len(texts) - len(results)))

    log.info(
        "[graph] done — %d entities across %d chunks (%d chunks got none)",
        sum(len(r) for r in results), len(results), sum(1 for r in results if not r),
    )
    return results
