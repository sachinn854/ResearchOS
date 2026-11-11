import asyncio
import json
import logging
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("researchos.agent")

from backend.agents.state import AgentState
from backend.core.config import settings
from backend.core.llm import llm as _llm, provider_kwargs
from backend.prompts.report import build_report_prompt
from backend.retrieval.context_assembler import ContextAssembler
from backend.retrieval.graph_expander import retrieve_by_entities
from backend.retrieval.hyde import generate_hypothetical_document
from backend.retrieval.hybrid_retriever import HybridRetriever
from backend.retrieval.web_searcher import search_web

_retriever = HybridRetriever()
_subq_retriever = HybridRetriever(use_hyde=False, use_graph=False)
_assembler = ContextAssembler()
_thread_pool = ThreadPoolExecutor(max_workers=4)

# Langfuse tracing — enabled only when keys are configured
_langfuse = None
if settings.langfuse_public_key and settings.langfuse_secret_key:
    from langfuse import Langfuse
    _langfuse = Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
    )
    log.info("Langfuse tracing enabled")

# BUG-033: decomposer_node removed — planner_node already handles decomposition


async def retriever_node(state: AgentState) -> dict:
    """Retrieve relevant chunks using hybrid retrieval.

    If sub_queries are present (from planner), runs retrieval for each
    sub-query and merges results before returning.
    """
    sub_queries = state.get("sub_queries") or []
    loop = asyncio.get_running_loop()

    if sub_queries:
        log.info("[retriever] running retrieval for %d sub-queries...", len(sub_queries))
        seen_keys: set[str] = set()
        merged: list = []

        # Run HyDE and Graph ONCE on original query to avoid calling per sub-query
        try:
            if _retriever.use_hyde:
                await loop.run_in_executor(_thread_pool, generate_hypothetical_document, state["query"])
        except Exception as exc:
            log.warning("[retriever] hyde pre-run failed: %s", exc)

        try:
            if _retriever.use_graph:
                graph_once = await loop.run_in_executor(
                    _thread_pool, retrieve_by_entities, state["query"], 10, state["domain"]
                )
                for c in graph_once:
                    key = f"{c.document_id}_{c.chunk_index}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        merged.append(c)
                log.info("[retriever] added %d chunks from graph (once)", len(graph_once))
        except Exception as exc:
            log.warning("[retriever] graph pre-run failed: %s", exc)

        # Run each sub-query with hyde+graph disabled
        for sq in sub_queries:
            sq_chunks, _ = await _subq_retriever.retrieve(
                sq, db=state["db"], top_k=5, domain=state["domain"]
            )
            for c in sq_chunks:
                key = f"{c.document_id}_{c.chunk_index}"
                if key not in seen_keys:
                    seen_keys.add(key)
                    merged.append(c)

        # BUG-027: was [:5] — keep more results proportional to sub-query count
        keep = min(5 * len(sub_queries), 15)
        merged = sorted(merged, key=lambda c: c.score, reverse=True)[:keep]
        log.info("[retriever] merged %d unique chunks from sub-queries", len(merged))
        return {"chunks": merged}

    log.info("[retriever] running hybrid retrieval...")
    chunks, best_dense_score = await _retriever.retrieve(
        state["query"], db=state["db"], top_k=5, domain=state["domain"]
    )
    log.info("[retriever] found %d chunks | best_dense=%.3f", len(chunks), best_dense_score)
    return {"chunks": chunks}


def web_search_node(state: AgentState) -> dict:
    """Fetch web results when KB has no relevant content."""
    log.info("[web_search] KB had no relevant chunks — searching web...")
    results = search_web(state["query"], max_results=5)

    if not results:
        log.info("[web_search] no web results found either")
        return {"chunks": [], "web_search_used": True, "web_sources": []}

    from backend.retrieval.dense_retriever import RetrievedChunk
    web_chunks = [
        RetrievedChunk(
            text=r["content"],
            document_id="web_search",
            chunk_index=i,
            page_number=None,
            score=0.7,
            domain=state.get("domain"),
        )
        for i, r in enumerate(results)
        if r.get("content", "").strip()
    ]

    web_sources = [{"title": r["title"], "url": r["url"]} for r in results]
    log.info("[web_search] using %d web results as context", len(web_chunks))

    _trigger_background_ingest(results, domain=state.get("domain"))

    return {
        "chunks": web_chunks,
        "web_search_used": True,
        "web_sources": web_sources,
        "is_relevant": True,
    }


def _trigger_background_ingest(results: list[dict], domain: str | None) -> None:
    try:
        from backend.workers.tasks import ingest_text_task
        for r in results:
            if r.get("content", "").strip():
                ingest_text_task.delay(
                    text=r["content"],
                    title=r.get("title", "Web Result"),
                    source_url=r.get("url", ""),
                    domain=domain,
                )
        log.info("[web_search] queued %d results for background ingestion", len(results))
    except Exception as exc:
        log.warning("[web_search] background ingest queue failed: %s", exc)


def grader_node(state: AgentState) -> dict:
    """Ask the LLM whether the retrieved chunks are relevant to the query."""
    log.info("[grader] checking relevance of %d chunks...", len(state["chunks"]))
    if not state["chunks"]:
        log.info("[grader] no chunks — marking not relevant")
        return {"is_relevant": False}

    preview = "\n\n".join(c.text[:300] for c in state["chunks"][:3])

    prompt = f"""You are a relevance grader. Decide if the retrieved document chunks are useful for answering the query.

Query: {state["query"]}

Retrieved chunks:
{preview}

Reply with JSON only — no explanation:
{{"relevant": true}} or {{"relevant": false}}"""

    # BUG-005: wrap LLM call in try/except — 429/500 must not crash the entire graph
    try:
        response = _llm.chat.completions.create(**provider_kwargs(),
            model=settings.fast_llm_model,  # BUG-034: classification uses fast model
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            # Not 10. gpt-oss reasons before it writes, and max_tokens caps the
            # reasoning trace and the visible content together — so a 10-token
            # budget returned finish_reason="length" and content=None every
            # single time. json.loads(None) then raised, the except below
            # swallowed it, and this node has been answering "relevant" no
            # matter what the chunks said.
            max_tokens=300,
        )
        data = json.loads(response.choices[0].message.content)
        is_relevant = bool(data.get("relevant", True))
        log.info("[grader] decision: %s", "relevant" if is_relevant else "NOT relevant")
        return {"is_relevant": is_relevant}
    except Exception as exc:
        log.warning("[grader] failed (defaulting to relevant): %s", exc)
        return {"is_relevant": True}


def generator_node(state: AgentState) -> dict:
    """Assemble context and generate an answer via OpenRouter."""
    log.info("[generator] generating answer from %d chunks...", len(state["chunks"]))
    context = _assembler.assemble(state["chunks"])
    prompt = build_report_prompt(
        context=context,
        question=state["query"],
        conversation_history=state.get("conversation_history"),
        domain=state.get("domain"),
    )

    trace = _langfuse.trace(name="rag-query", input={"query": state["query"]}) if _langfuse else None
    span = trace.span(name="generator", input={"chunks": len(state["chunks"])}) if trace else None

    response = _llm.chat.completions.create(**provider_kwargs(),
        model=settings.llm_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=4096,
    )

    answer = response.choices[0].message.content
    usage = response.usage

    if span:
        span.end(output={
            "answer_length": len(answer),
            "total_tokens": usage.total_tokens if usage else None,
            "prompt_tokens": usage.prompt_tokens if usage else None,
            "completion_tokens": usage.completion_tokens if usage else None,
        })
    if trace:
        trace.update(output={"answer_preview": answer[:200]})

    sources = [
        {
            "document_id": c.document_id,
            "chunk_index": c.chunk_index,
            "page_number": c.page_number,
            "score": round(c.score, 4),
        }
        for c in state["chunks"]
    ]

    log.info("[generator] answer generated (%d chars) | tokens=%s",
             len(answer), usage.total_tokens if usage else "?")
    return {"answer": answer, "context": context, "sources": sources}


def stream_generator_node(state: AgentState) -> Generator[str, None, None]:
    """Streaming version of generator — yields tokens as they arrive via OpenRouter."""
    log.info("[generator:stream] starting for %d chunks...", len(state["chunks"]))
    context = _assembler.assemble(state["chunks"])
    prompt = build_report_prompt(
        context=context,
        question=state["query"],
        conversation_history=state.get("conversation_history"),
        domain=state.get("domain"),
    )

    stream = _llm.chat.completions.create(**provider_kwargs(),
        model=settings.llm_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        # 4096 cut long report answers off mid-sentence (finish_reason="length").
        # The model supports 64k output; tokens are billed only as used, so the
        # cap is headroom, not a budget.
        max_tokens=16384,
        stream=True,
    )

    for chunk in stream:
        # BUG-006: OpenRouter can return chunks with empty choices list → IndexError
        if not chunk.choices:
            continue
        token = chunk.choices[0].delta.content or ""
        if token:
            yield token

    log.info("[generator:stream] stream complete")


def planner_node(state: AgentState) -> dict:
    """High-level planning — decide approach before retrieval starts.

    Outputs a plan dict and sets sub_queries if the query is complex.
    """
    query = state["query"]
    log.info("[planner] analyzing query...")

    prompt = f"""You are a research query planner. Analyze this query and return a JSON plan.

Query: {query}

Return JSON only:
{{
  "complexity": "simple" | "moderate" | "complex",
  "approach": "direct" | "multi_step" | "comparative",
  "sub_queries": [],
  "notes": "brief note on strategy"
}}

Rules for sub_queries:
- simple/direct → empty list []
- moderate → 2 sub-queries
- complex/comparative → 2-3 sub-queries, each standalone and focused"""

    try:
        response = _llm.chat.completions.create(**provider_kwargs(),
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=250,
        )
        plan = json.loads(response.choices[0].message.content)
        sub_queries = [q for q in plan.get("sub_queries", []) if q.strip()][:3]
        log.info("[planner] complexity=%s | approach=%s | sub_queries=%d",
                 plan.get("complexity"), plan.get("approach"), len(sub_queries))
        return {"plan": plan, "sub_queries": sub_queries}
    except Exception as exc:
        log.warning("[planner] failed, using defaults: %s", exc)
        return {"plan": {"complexity": "simple", "approach": "direct", "notes": "fallback"}, "sub_queries": []}


def contradiction_detector_node(state: AgentState) -> dict:
    """Detect contradictions between retrieved chunks before generation."""
    chunks = state["chunks"]
    log.info("[contradiction_detector] checking %d chunks for contradictions...", len(chunks))

    if len(chunks) < 2:
        return {"contradictions": []}

    # BUG-029: was chunks[:4] — include all top-5 chunks
    previews = "\n\n".join(
        f"[Chunk {i+1}]: {c.text[:400]}"
        for i, c in enumerate(chunks[:5])
    )

    prompt = f"""You are a contradiction detector for a research assistant.
Check if any of these document chunks contradict each other.

{previews}

Reply with JSON only:
{{"contradictions": [
  {{"chunk_a": 1, "chunk_b": 3, "description": "brief description of contradiction"}}
]}}
If no contradictions: {{"contradictions": []}}"""

    try:
        response = _llm.chat.completions.create(**provider_kwargs(),
            model=settings.fast_llm_model,  # BUG-034: use fast model for classification
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=300,
        )
        data = json.loads(response.choices[0].message.content)
        contradictions = data.get("contradictions", [])
        if contradictions:
            log.info("[contradiction_detector] found %d contradiction(s)", len(contradictions))
        else:
            log.info("[contradiction_detector] no contradictions found")
        return {"contradictions": contradictions}
    except Exception as exc:
        log.warning("[contradiction_detector] failed: %s", exc)
        return {"contradictions": []}


def citation_verifier_node(state: AgentState) -> dict:
    """Verify that citations in the generated answer are supported by the chunks."""
    import re
    answer = state.get("answer", "")
    chunks = state.get("chunks", [])
    log.info("[citation_verifier] verifying citations in answer...")

    if not answer or not chunks:
        return {"citation_verified": True}

    cited = set(int(m) for m in re.findall(r'\[(\d+)\]', answer))
    if not cited:
        log.info("[citation_verifier] no citations found in answer")
        return {"citation_verified": True}

    chunk_texts = {i + 1: c.text[:600] for i, c in enumerate(chunks)}
    cited_chunks = {i: chunk_texts[i] for i in cited if i in chunk_texts}

    if not cited_chunks:
        return {"citation_verified": True}

    chunks_preview = "\n\n".join(f"[{i}]: {t}" for i, t in cited_chunks.items())

    prompt = f"""You are a citation verifier. Check if the answer's citations are supported by the source chunks.

Answer: {answer[:3000]}

Source chunks:
{chunks_preview}

Reply with JSON only:
{{"verified": true, "unverified": []}}
or
{{"verified": false, "unverified": [1, 3]}}"""

    # BUG-028: was answer[:800] — check full answer (up to 3000 chars)
    try:
        response = _llm.chat.completions.create(**provider_kwargs(),
            model=settings.fast_llm_model,  # BUG-034: use fast model for classification
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=150,
        )
        data = json.loads(response.choices[0].message.content)
        unverified = data.get("unverified", [])

        if unverified:
            warning = f"\n\n[Note: Citations {unverified} could not be fully verified against the source chunks.]"
            log.info("[citation_verifier] unverified citations: %s", unverified)
            return {"citation_verified": False, "answer": answer + warning}

        log.info("[citation_verifier] all citations verified")
        return {"citation_verified": True}
    except Exception as exc:
        log.warning("[citation_verifier] failed: %s", exc)
        return {"citation_verified": True}


def hallucination_checker_node(state: AgentState) -> dict:
    """Check whether the generated answer is grounded in the retrieved context."""
    log.info("[hallucination_checker] checking if answer is grounded...")
    prompt = f"""You are a hallucination detector. Check if the answer contains only information present in the context.

Context:
{state["context"][:2000]}

Answer:
{state["answer"]}

Reply with JSON only — no explanation:
{{"grounded": true}} or {{"grounded": false}}"""

    # BUG-005: wrap LLM call in try/except — 429/500 must not crash after generation succeeded
    try:
        response = _llm.chat.completions.create(**provider_kwargs(),
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            # See grader_node — same reasoning-token trap. With 10 this check
            # never once ran; it reported "grounded" for every answer because
            # the exception handler is its default.
            max_tokens=300,
        )
        data = json.loads(response.choices[0].message.content)
        has_hallucination = not bool(data.get("grounded", True))
        log.info("[hallucination_checker] result: %s", "HALLUCINATION DETECTED" if has_hallucination else "grounded")
        return {"has_hallucination": has_hallucination}
    except Exception as exc:
        log.warning("[hallucination_checker] failed (defaulting to grounded): %s", exc)
        return {"has_hallucination": False}
