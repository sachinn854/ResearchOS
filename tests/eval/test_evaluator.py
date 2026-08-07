"""Tests for the LLM-as-judge evaluator.

The graph and the judge are both stubbed, so these run offline and cost nothing.
The behaviour worth pinning down is how the evaluator handles bad input, because
that is where eval harnesses quietly start reporting numbers that are not true.
"""
import asyncio
from types import SimpleNamespace

import pytest

from backend.evaluation import evaluator as ev
from backend.evaluation.schemas import EvalSample


def _score_reply(score):
    return f'{{"score": {score}, "reason": "stub"}}'


@pytest.fixture
def judge(monkeypatch):
    """Replace the LLM with a stub. Returns the recorded call list."""
    calls: list[dict] = []

    def install(reply):
        def create(**kwargs):
            calls.append(kwargs)
            content = reply(kwargs) if callable(reply) else reply
            if isinstance(content, Exception):
                raise content
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

        monkeypatch.setattr(
            ev, "_llm",
            SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
        )
        return calls

    return install


@pytest.fixture
def build(monkeypatch):
    """Build a RAGEvaluator whose graph returns a canned pipeline result."""
    def make(answer="An answer.", chunk_texts=("chunk one", "chunk two"), raises=None):
        class FakeGraph:
            async def ainvoke(self, state):
                if raises:
                    raise raises
                return {
                    "answer": answer,
                    "chunks": [SimpleNamespace(text=t) for t in chunk_texts],
                }

        monkeypatch.setattr(ev, "build_graph", lambda: FakeGraph())
        return ev.RAGEvaluator()

    return make


SAMPLE = EvalSample(question="What is RRF?", ground_truth="Reciprocal Rank Fusion fuses ranked lists.")


def _fresh_sample():
    return EvalSample(question=SAMPLE.question, ground_truth=SAMPLE.ground_truth)


# --- score parsing ---------------------------------------------------------

@pytest.mark.parametrize("raw, expected", [
    ('{"score": 0.75, "reason": "ok"}', 0.75),
    ('```json\n{"score": 0.5, "reason": "fenced"}\n```', 0.5),
    ('Sure! {"score": 1, "reason": "prose around it"}', 1.0),
    ('{"score": 85, "reason": "answered on a 0-100 scale"}', 0.85),
    ('{"score": 4, "reason": "answered on a 1-5 scale"}', 0.8),
    ('{"score": -3, "reason": "out of range"}', 0.0),
])
def test_parses_score_variants(raw, expected):
    score, _ = ev._parse_score(raw)
    assert score == pytest.approx(expected)


@pytest.mark.parametrize("raw", [None, "", "no json here", '{"score": "high"}', "{broken"])
def test_unparseable_score_is_none_not_zero(raw):
    """None means "not measured" and is skipped when averaging. Returning 0.0
    would drag the reported average down and look like a real result."""
    score, reason = ev._parse_score(raw)
    assert score is None
    assert reason


# --- end to end (stubbed) --------------------------------------------------

def test_happy_path_scores_all_four_metrics(judge, build):
    calls = judge(_score_reply(0.8))
    result = asyncio.run(build().run([_fresh_sample()], db=None))[0]

    assert result.summary() == {
        "faithfulness": 0.8,
        "answer_relevancy": 0.8,
        "context_recall": 0.8,
        "context_precision": 0.8,
    }
    assert len(calls) == 4          # one call per metric, not one call for all four


def test_no_context_scores_retrieval_zero_and_generation_none(judge, build):
    """Retrieval found nothing. That is a real 0 for the retrieval metrics, but
    the generator cannot be blamed for it, so its metrics are not measured."""
    calls = judge(_score_reply(0.9))
    result = asyncio.run(build(chunk_texts=()).run([_fresh_sample()], db=None))[0]

    assert result.summary() == {
        "faithfulness": None,
        "answer_relevancy": None,
        "context_recall": 0.0,
        "context_precision": 0.0,
    }
    assert calls == []              # nothing to judge, so no money spent


def test_empty_answer_leaves_generation_metrics_unmeasured(judge, build):
    judge(_score_reply(0.7))
    result = asyncio.run(build(answer="").run([_fresh_sample()], db=None))[0]
    summary = result.summary()

    assert summary["faithfulness"] is None
    assert summary["answer_relevancy"] is None
    # Retrieval still worked, so it still gets graded.
    assert summary["context_recall"] == 0.7
    assert summary["context_precision"] == 0.7


def test_pipeline_crash_does_not_abort_the_run(judge, build):
    judge(_score_reply(0.6))
    results = asyncio.run(build(raises=RuntimeError("qdrant down")).run(
        [_fresh_sample(), _fresh_sample()], db=None))

    assert len(results) == 2        # the run completes and reports the failure
    assert all(r.context_recall == 0.0 for r in results)


def test_judge_failure_yields_none_not_zero(judge, build):
    judge(lambda k: RuntimeError("429 rate limited"))
    result = asyncio.run(build().run([_fresh_sample()], db=None))[0]

    assert result.summary() == {
        "faithfulness": None,
        "answer_relevancy": None,
        "context_recall": None,
        "context_precision": None,
    }


def test_judge_runs_deterministically(judge, build):
    calls = judge(_score_reply(0.5))
    asyncio.run(build().run([_fresh_sample()], db=None))

    # temperature must be 0, otherwise re-running the golden set gives different
    # numbers and a regression is indistinguishable from judge noise.
    assert all(c["temperature"] == 0 for c in calls)


def test_judge_uses_the_strong_model(judge, build):
    calls = judge(_score_reply(0.5))
    evaluator = build()
    asyncio.run(evaluator.run([_fresh_sample()], db=None))

    assert evaluator.judge_model == ev.settings.llm_model
    assert all(c["model"] == ev.settings.llm_model for c in calls)


def test_evaluation_does_not_use_conversation_memory(judge, build, monkeypatch):
    """Passing a session_id would let one sample's answer land in the next
    sample's context, making the run unrepeatable."""
    seen = {}

    class FakeGraph:
        async def ainvoke(self, state):
            seen.update(state)
            return {"answer": "a", "chunks": [SimpleNamespace(text="c")]}

    monkeypatch.setattr(ev, "build_graph", lambda: FakeGraph())
    judge(_score_reply(0.5))
    asyncio.run(ev.RAGEvaluator().run([_fresh_sample()], db=None))

    assert seen["session_id"] is None
    assert seen["conversation_history"] == []


def test_contexts_are_truncated_and_capped():
    """The judge prompt must not grow without bound with retrieved chunks."""
    formatted = ev._format_contexts([f"chunk {i} " + "x" * 5000 for i in range(30)])

    assert formatted.count("[1]") == 1
    assert f"[{ev._MAX_CONTEXTS_JUDGED}]" in formatted
    assert f"[{ev._MAX_CONTEXTS_JUDGED + 1}]" not in formatted
    assert len(formatted) < ev._MAX_CONTEXTS_JUDGED * (ev._MAX_CHARS_PER_CONTEXT + 20)


def test_no_context_message_is_explicit():
    assert "no context" in ev._format_contexts([]).lower()
