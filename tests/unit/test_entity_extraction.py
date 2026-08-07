"""Tests for the batched entity extractor (BUG-014).

The LLM client is replaced with a stub, so these run offline and cost nothing.
What we care about:
  - chunks and entity lists stay aligned (a mismatch would silently drop chunks
    in the pipeline's zip)
  - one call covers a batch instead of one call per chunk
  - a rate limit does not trigger a retry storm
  - the event loop is not blocked while calls are in flight
"""
import asyncio
import time
from types import SimpleNamespace

import pytest

from backend.ingestion.graph import entity_extractor as ee


@pytest.fixture
def stub_llm(monkeypatch):
    """Swap in a fake LLM. Returns the list that records every call made."""
    calls: list[dict] = []

    def install(reply):
        def create(**kwargs):
            calls.append(kwargs)
            content = reply(kwargs) if callable(reply) else reply
            if isinstance(content, Exception):
                raise content
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

        monkeypatch.setattr(
            ee, "_llm",
            SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
        )
        return calls

    return install


def _is_batch_prompt(kwargs) -> bool:
    return kwargs["messages"][0]["content"].startswith("Extract key technical entities from each")


def _numbered_reply(kwargs) -> str:
    """A well-behaved batch answer — wrapped in a markdown fence on purpose."""
    blocks = kwargs["messages"][1]["content"].count("[")
    body = ", ".join(f'"{i}": ["BERT", "rrf", "bert"]' for i in range(1, blocks + 1))
    return "Here you go:\n```json\n{" + body + "}\n```"


def test_batches_instead_of_one_call_per_chunk(stub_llm):
    calls = stub_llm(_numbered_reply)
    texts = [f"chunk {i} about retrieval" for i in range(13)]

    result = asyncio.run(ee.extract_entities_for_chunks(texts))

    assert len(result) == len(texts)          # alignment is the critical property
    assert len(calls) == 3                    # 13 chunks / batch of 5, not 13 calls


def test_entities_are_lowercased_and_deduplicated(stub_llm):
    stub_llm(_numbered_reply)
    assert asyncio.run(ee.extract_entities_for_chunks(["one chunk"])) == [["bert", "rrf"]]


def test_junk_entities_are_dropped(stub_llm):
    stub_llm('{"1": ["this is a whole sentence and not an entity at all", "hnsw", 42, "", "  "]}')
    assert asyncio.run(ee.extract_entities_for_chunks(["one chunk"])) == [["hnsw"]]


def test_invalid_json_falls_back_to_single_calls(stub_llm):
    calls = stub_llm(lambda k: "I cannot help with that." if _is_batch_prompt(k)
                     else '{"entities": ["hyde"]}')

    result = asyncio.run(ee.extract_entities_for_chunks([f"chunk {i}" for i in range(5)]))

    assert result == [["hyde"]] * 5
    assert len(calls) == 6                    # 1 bad batch + 5 individual retries


def test_unexpected_json_shape_falls_back_to_single_calls(stub_llm):
    """Valid JSON, but not the numbered map we asked for."""
    calls = stub_llm(lambda k: '{"blocks": []}' if _is_batch_prompt(k)
                     else '{"entities": ["rrf"]}')

    result = asyncio.run(ee.extract_entities_for_chunks([f"chunk {i}" for i in range(5)]))

    assert result == [["rrf"]] * 5
    assert len(calls) == 6


def test_rate_limit_does_not_cause_a_retry_storm(stub_llm):
    """A 429 must cost one call per batch. Retrying each chunk individually here
    would fire five more doomed calls and make the rate limit worse."""
    calls = stub_llm(lambda k: RuntimeError("429 rate limited"))

    result = asyncio.run(ee.extract_entities_for_chunks([f"chunk {i}" for i in range(7)]))

    assert result == [[]] * 7                 # degrades, never raises
    assert len(calls) == 2                    # 7 chunks = 2 batches = 2 calls


def test_disabled_flag_makes_no_calls(stub_llm, monkeypatch):
    calls = stub_llm(_numbered_reply)
    monkeypatch.setattr(ee.settings, "enable_entity_extraction", False)

    result = asyncio.run(ee.extract_entities_for_chunks([f"chunk {i}" for i in range(13)]))

    assert result == [[]] * 13
    assert calls == []


def test_empty_input(stub_llm):
    calls = stub_llm(_numbered_reply)
    assert asyncio.run(ee.extract_entities_for_chunks([])) == []
    assert calls == []


def test_event_loop_stays_responsive(stub_llm):
    """The OpenAI client is synchronous. If it were awaited directly instead of
    via asyncio.to_thread, nothing else on the loop could run during ingestion —
    which is exactly the half of BUG-014 that froze the API server."""
    stub_llm(lambda k: (time.sleep(0.15), _numbered_reply(k))[1])

    ticks = 0

    async def scenario():
        nonlocal ticks

        async def heartbeat():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        beat = asyncio.create_task(heartbeat())
        await ee.extract_entities_for_chunks([f"chunk {i}" for i in range(10)])
        beat.cancel()

    asyncio.run(scenario())

    assert ticks > 5, "event loop was blocked — the call is not running in a thread"
