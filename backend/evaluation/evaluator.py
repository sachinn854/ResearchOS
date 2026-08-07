"""LLM-as-judge evaluation for the RAG pipeline.

`backend/evaluation/evaluator.py` was deleted in commit 6bec019 while
`scripts/run_eval.py` kept importing `RAGEvaluator`, so `python -m
scripts.run_eval` died with an ImportError. This is the replacement.

**Why judge with an LLM instead of RAGAS?**
`ragas` and `datasets` were still sitting in requirements.txt but nothing
imported them. Wiring ragas back up would mean adapting it to our OpenRouter
client and pulling in its dependency tree (datasets, pyarrow, and a pinned
LangChain adapter) for four numbers we can ask for directly. The four metrics
below are the same ones ragas reports, computed with one graded prompt each.

**What the four metrics mean**

| metric | question it answers | what it catches |
|---|---|---|
| `faithfulness` | Is every claim in the answer backed by the retrieved context? | hallucination |
| `answer_relevancy` | Does the answer actually address the question? | evasive or off-topic answers |
| `context_recall` | Does the retrieved context contain what the reference answer says? | retrieval missing the right chunks |
| `context_precision` | What fraction of retrieved chunks were useful? | retrieval returning filler |

The first two grade generation, the last two grade retrieval. Keeping them apart
is the point: if faithfulness is high but context_recall is low, the generator is
doing its job and retrieval is the bottleneck — which is exactly the signal you
need before deciding to add a reranker.
"""
import asyncio
import json
import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.graph import build_graph
from backend.core.config import settings
from backend.core.llm import llm as _llm, provider_kwargs
from backend.evaluation.schemas import EvalResult, EvalSample

log = logging.getLogger("researchos.evaluation")

# How many context passages we show the judge. More context means a slower, more
# expensive and less reliable judgement, and by this depth the tail chunks rarely
# change the verdict.
_MAX_CONTEXTS_JUDGED = 8
_MAX_CHARS_PER_CONTEXT = 900

_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)

# NOTE: every prompt here is assembled with f-strings and plain concatenation,
# never str.format(). These prompts contain literal JSON braces, and format()
# reads `{"score": ...}` as a replacement field named `"score"` and raises
# KeyError. Doubling the braces to escape them works but is easy to get wrong on
# the next edit, so we simply never call format() on them.

_JUDGE_RULES = """You are a strict evaluator for a retrieval-augmented generation system.

Reply with ONLY a JSON object, no prose and no markdown fence:
{"score": 0.0, "reason": "one short sentence"}

The score is a float from 0.0 to 1.0. Do not round to whole numbers — a partial
match should get a partial score. Be strict: reward what is actually present, not
what you assume was intended."""

_FAITHFULNESS_TASK = """Task: decide how well the ANSWER is supported by the CONTEXT.

1.0 = every factual claim in the answer can be traced to the context.
0.5 = roughly half the claims are supported, the rest are not in the context.
0.0 = the answer is essentially unsupported by the context.

Judge support only. Do not reward the answer for being well written, complete, or
true in general — only for being grounded in this context."""

_ANSWER_RELEVANCY_TASK = """Task: decide how directly the ANSWER addresses the QUESTION.

1.0 = it answers exactly what was asked.
0.5 = it is on topic but talks around the question or answers only part of it.
0.0 = it is off topic, or it refuses.

Judge relevance only. Do NOT judge whether the answer is factually correct."""

_CONTEXT_RECALL_TASK = """Task: decide how much of the REFERENCE ANSWER's information is present in the CONTEXT.

1.0 = every fact in the reference answer can be found somewhere in the context.
0.5 = about half of the reference answer's facts are present.
0.0 = the context contains none of them.

This measures retrieval, not generation. Ignore the wording — only check whether
the information is there."""

_CONTEXT_PRECISION_TASK = """Task: decide what fraction of the CONTEXT passages are useful for answering the QUESTION.

1.0 = every passage contributes something useful.
0.5 = about half are useful and the rest are filler.
0.0 = none of them help answer the question.

A passage that is on the general topic but cannot help answer this specific
question does NOT count as useful."""


def _parse_score(raw: str | None) -> tuple[float | None, str]:
    """Pull {"score": ..., "reason": ...} out of a judge reply.

    Returns (None, why) when the reply is unusable. None is deliberate — it means
    "not measured" and gets skipped when averaging, which is honest. Substituting
    0.0 would quietly drag the reported score down and look like a real result.
    """
    if not raw:
        return None, "empty reply"

    match = _JSON_OBJECT.search(raw)
    if not match:
        return None, f"no JSON in reply: {raw[:80]!r}"

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON ({exc})"

    score = data.get("score")
    if not isinstance(score, (int, float)):
        return None, f"score is not a number: {score!r}"

    # Judges occasionally answer on a 0-100 or 1-5 scale despite the instruction.
    if score > 1.0:
        score = score / 100.0 if score > 5.0 else score / 5.0

    return max(0.0, min(1.0, float(score))), str(data.get("reason", ""))


def _format_contexts(contexts: list[str]) -> str:
    if not contexts:
        return "(no context was retrieved)"
    return "\n\n".join(
        f"[{i}] {text[:_MAX_CHARS_PER_CONTEXT]}"
        for i, text in enumerate(contexts[:_MAX_CONTEXTS_JUDGED], start=1)
    )


class RAGEvaluator:
    """Runs the real pipeline on a golden set, then grades the results.

    Both halves matter. Answers come from `build_graph()` — the same graph the
    /research/query endpoint uses — so the numbers describe the shipped system
    rather than a simplified copy of it.
    """

    def __init__(self, judge_model: str | None = None):
        # The judge uses the strong model, not fast_llm_model. A weak judge
        # produces noisy scores, and noisy scores are worse than no scores
        # because you act on them.
        self.judge_model = judge_model or settings.llm_model
        self._graph = build_graph()

    async def run(self, samples: list[EvalSample], db: AsyncSession) -> list[EvalResult]:
        results: list[EvalResult] = []

        for position, sample in enumerate(samples, start=1):
            log.info("[eval] %d/%d — %s", position, len(samples), sample.question)

            # Sequential on purpose. A SQLAlchemy AsyncSession is not safe to use
            # from several coroutines at once, and run_eval.py hands us one shared
            # session. Grading below is concurrent because it never touches the DB.
            await self._answer(sample, db)
            results.append(await self._judge(sample))

        return results

    async def _answer(self, sample: EvalSample, db: AsyncSession) -> None:
        """Fill in sample.answer and sample.contexts by running the pipeline."""
        try:
            state = await self._graph.ainvoke({
                "query": sample.question,
                "domain": None,
                "db": db,
                # No session_id: conversation memory would leak one sample's
                # answer into the next one's context and make runs unrepeatable.
                "session_id": None,
                "conversation_history": [],
                "plan": {},
                "sub_queries": [],
                "chunks": [],
                "contradictions": [],
                "context": "",
                "answer": "",
                "is_relevant": True,
                "has_hallucination": False,
                "citation_verified": True,
                "web_search_used": False,
                "web_sources": [],
                "sources": [],
            })
        except Exception as exc:
            log.error("[eval] pipeline failed for %r: %s", sample.question, exc)
            sample.answer = ""
            sample.contexts = []
            return

        sample.answer = state.get("answer") or ""
        sample.contexts = [
            text for text in (getattr(chunk, "text", "") for chunk in state.get("chunks") or [])
            if text
        ]

        log.info("[eval]   -> %d chunks, %d-char answer", len(sample.contexts), len(sample.answer))

    async def _judge(self, sample: EvalSample) -> EvalResult:
        question = sample.question.strip()
        answer = sample.answer.strip()
        contexts = _format_contexts(sample.contexts)

        # Retrieval returned nothing. The two retrieval metrics are a genuine 0 —
        # that is the finding. The generation metrics are None, not 0: there is no
        # answer to grade, and scoring an absent answer 0 would blame the
        # generator for a retrieval failure.
        if not sample.contexts:
            log.warning("[eval] no context retrieved for %r", question)
            return EvalResult(
                faithfulness=None,
                answer_relevancy=None,
                context_recall=0.0,
                context_precision=0.0,
            )

        faithfulness_prompt = (
            f"{_FAITHFULNESS_TASK}\n\n"
            f"QUESTION:\n{question}\n\n"
            f"CONTEXT:\n{contexts}\n\n"
            f"ANSWER:\n{answer or '(the system produced no answer)'}"
        )
        relevancy_prompt = (
            f"{_ANSWER_RELEVANCY_TASK}\n\n"
            f"QUESTION:\n{question}\n\n"
            f"ANSWER:\n{answer or '(the system produced no answer)'}"
        )
        recall_prompt = (
            f"{_CONTEXT_RECALL_TASK}\n\n"
            f"QUESTION:\n{question}\n\n"
            f"REFERENCE ANSWER:\n{sample.ground_truth.strip()}\n\n"
            f"CONTEXT:\n{contexts}"
        )
        precision_prompt = (
            f"{_CONTEXT_PRECISION_TASK}\n\n"
            f"QUESTION:\n{question}\n\n"
            f"CONTEXT:\n{contexts}"
        )

        # Four independent judgements, so run them together. Each is a separate
        # call on purpose: asking one call for all four metrics lets the model
        # anchor them to each other and they end up suspiciously similar.
        faithfulness, relevancy, recall, precision = await asyncio.gather(
            self._score("faithfulness", faithfulness_prompt),
            self._score("answer_relevancy", relevancy_prompt),
            self._score("context_recall", recall_prompt),
            self._score("context_precision", precision_prompt),
        )

        # An empty answer cannot be graded for grounding or relevance.
        if not answer:
            faithfulness, relevancy = None, None

        return EvalResult(
            faithfulness=faithfulness,
            answer_relevancy=relevancy,
            context_recall=recall,
            context_precision=precision,
        )

    async def _score(self, metric: str, prompt: str) -> float | None:
        def call() -> str | None:
            response = _llm.chat.completions.create(**provider_kwargs(),
                model=self.judge_model,
                messages=[
                    {"role": "system", "content": _JUDGE_RULES},
                    {"role": "user", "content": prompt},
                ],
                # Deterministic, so re-running the same golden set gives the same
                # numbers. Without this you cannot tell a real regression from
                # judge noise.
                temperature=0,
                max_tokens=200,
            )
            return response.choices[0].message.content

        try:
            # The OpenAI client is synchronous; to_thread is what makes the
            # gather above actually concurrent instead of four calls in a row.
            raw = await asyncio.to_thread(call)
        except Exception as exc:
            log.warning("[eval] %s judge call failed: %s", metric, exc)
            return None

        score, note = _parse_score(raw)
        if score is None:
            log.warning("[eval] %s could not be scored — %s", metric, note)
        else:
            log.debug("[eval] %s = %.2f (%s)", metric, score, note)
        return score
