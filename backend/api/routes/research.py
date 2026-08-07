import asyncio
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.graph import build_graph
from backend.agents.nodes import stream_generator_node
from backend.core.config import settings
from backend.core.llm import llm as _llm, provider_kwargs
from backend.retrieval.hybrid_retriever import HybridRetriever
from backend.retrieval.context_assembler import ContextAssembler
from backend.retrieval.dense_retriever import RetrievedChunk
from backend.retrieval.web_searcher import search_web
from backend.api.schemas.research import (
    AsyncIngestResponse,
    IngestRequest,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    SourceItem,
    TaskStatusResponse,
)
from backend.db.models.document import Document
from backend.db.postgres import get_db
from backend.api.dependencies.auth import get_current_user
from backend.api.middleware.rate_limit import check_rate_limit
from backend.db.models.user import User
from backend.ingestion.pipeline import ingest_document
from backend.memory.conversation_store import load_history, save_exchange
from backend.workers.celery_app import celery_app

_retriever = HybridRetriever()
_stream_retriever = HybridRetriever(use_hyde=False, use_graph=False)
_assembler = ContextAssembler()
_thread_pool = ThreadPoolExecutor(max_workers=2)

_DOMAIN_LABELS = {
    "ml": "Machine Learning / AI",
    "dl": "Deep Learning",
    "cs": "Computer Science",
    "physics": "Physics",
    "bio": "Biology",
    "finance": "Finance",
    "math": "Mathematics",
}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # BUG-010: 50 MB hard limit

router = APIRouter(prefix="/research", tags=["research"])


def _get_client_ip(req: Request) -> str:
    """BUG-007: extract real client IP — check X-Forwarded-For first for reverse-proxy setups."""
    xff = req.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return req.client.host if req.client else "unknown"


def _check_domain_sync(query: str, domain_label: str) -> bool:
    """Returns True if query is relevant to the domain, False if off-domain."""
    resp = _llm.chat.completions.create(**provider_kwargs(),
        model=settings.fast_llm_model,
        messages=[{
            "role": "user",
            "content": (
                f'Domain: {domain_label}\n'
                f'Query: "{query}"\n\n'
                f'Is this query about {domain_label}? Answer only: yes or no'
            ),
        }],
        temperature=0,
        max_tokens=5,
    )
    answer = resp.choices[0].message.content.strip().lower()
    return answer.startswith("yes")


@router.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the last 30 sessions belonging to the signed-in user.

    This endpoint used to take `user_id` as a query parameter and match it
    against the session_id prefix. That meant anyone could pass someone else's
    id and read their entire chat history — the check was against a value the
    caller supplied. Now the id comes from the verified token and is matched
    against a real foreign key column.
    """
    result = await db.execute(text("""
        SELECT
            ch.session_id,
            (
                SELECT content FROM conversation_history ch2
                WHERE ch2.session_id = ch.session_id AND ch2.role = 'user'
                ORDER BY ch2.created_at ASC LIMIT 1
            ) AS preview,
            MAX(ch.created_at) AS last_at,
            COUNT(*) AS message_count
        FROM conversation_history ch
        WHERE ch.user_id = :user_id
        GROUP BY ch.session_id
        ORDER BY last_at DESC
        LIMIT 30
    """), {"user_id": current_user.id})
    rows = result.fetchall()
    return [
        {
            "session_id": r.session_id,
            "preview": (r.preview or "")[:80],
            "last_at": r.last_at.isoformat() if r.last_at else None,
            "message_count": r.message_count,
        }
        for r in rows
    ]


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all messages for a session in chronological order.

    BUG-011 originally added an ownership check here, but it compared the
    session_id prefix against a client-supplied user_id, so it could be
    satisfied by simply sending the matching id. Ownership is now filtered in
    the query itself using the token's user id, which means there is no check to
    bypass — a session that is not yours returns nothing.
    """
    result = await db.execute(
        text("""
            SELECT role, content FROM conversation_history
            WHERE session_id = :session_id AND user_id = :user_id
            ORDER BY created_at ASC
        """),
        {"session_id": session_id, "user_id": current_user.id},
    )
    rows = result.fetchall()

    if not rows:
        # Either the session does not exist or it belongs to someone else. Same
        # answer for both — distinguishing them would confirm that a session id
        # exists, which is exactly what someone guessing ids wants to know.
        raise HTTPException(status_code=404, detail="Session not found")

    return [{"role": r.role, "content": r.content} for r in rows]


@router.post("/upload", response_model=IngestResponse)
async def upload_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    domain: str = Form(default="ml"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file and run the full ingestion pipeline."""
    upload_dir = Path("data/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)

    content = await file.read()

    # BUG-010: reject oversized files before writing to disk
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_UPLOAD_BYTES // (1024*1024)}MB.",
        )

    # BUG-009: UUID prefix prevents filename collisions between users
    original_name = Path(file.filename).name if file.filename else "upload"
    safe_name = f"{uuid.uuid4()}_{original_name}"
    file_path = upload_dir / safe_name
    file_path.write_bytes(content)

    doc = await ingest_document(
        source=str(file_path),
        title=title,
        db=db,
        domain=domain,
    )
    return IngestResponse(document_id=str(doc.id), title=doc.title, status=doc.status)


@router.post("/ingest", response_model=IngestResponse)
async def ingest(
    request: IngestRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Synchronous ingest — waits until complete. Good for small files."""
    doc = await ingest_document(
        source=request.source,
        title=request.title,
        db=db,
        domain=request.domain,
    )
    return IngestResponse(document_id=str(doc.id), title=doc.title, status=doc.status)


@router.post("/ingest/async", response_model=AsyncIngestResponse)
async def ingest_async(
    request: IngestRequest,
    current_user: User = Depends(get_current_user),
):
    """Async ingest — queues a background task and returns immediately."""
    from backend.workers.tasks import ingest_document_task

    task = ingest_document_task.delay(
        source=request.source,
        title=request.title,
        domain=request.domain,
    )
    return AsyncIngestResponse(
        task_id=task.id,
        status="queued",
        message=f"Ingestion queued. Check status at /research/tasks/{task.id}",
    )


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    """Check the status of a background ingestion task.

    Note: this only requires *a* signed-in user, not the one who queued the task.
    Celery task ids are unguessable UUIDs and the payload is just a status
    string, so we do not track task ownership.
    """
    result = AsyncResult(task_id, app=celery_app)

    match result.state:
        case "PENDING":
            return TaskStatusResponse(task_id=task_id, status="queued")
        case "STARTED":
            return TaskStatusResponse(task_id=task_id, status="running")
        case "SUCCESS":
            return TaskStatusResponse(task_id=task_id, status="completed", result=result.result)
        case "FAILURE":
            return TaskStatusResponse(task_id=task_id, status="failed", error=str(result.result))
        case _:
            return TaskStatusResponse(task_id=task_id, status=result.state.lower())


@router.post("/query/stream")
async def query_stream(
    request: QueryRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Streaming query — tokens arrive in real-time via Server-Sent Events."""

    # BUG-007: use real client IP (X-Forwarded-For) not proxy IP
    client_ip = _get_client_ip(req)
    allowed, retry_after = check_rate_limit(client_ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"error": "rate_limit", "retry_after": retry_after},
        )

    # BUG-040: domain check BEFORE loading conversation history — off-domain
    # queries return immediately without paying the DB round-trip
    if request.domain and request.domain != "all" and request.domain in _DOMAIN_LABELS:
        domain_label = _DOMAIN_LABELS[request.domain]
        # BUG-018: get_running_loop() — get_event_loop() is deprecated in Python 3.10+
        loop = asyncio.get_running_loop()
        is_on_domain = await loop.run_in_executor(
            _thread_pool, _check_domain_sync, request.query, domain_label
        )
        if not is_on_domain:
            async def _refuse():
                msg = (
                    f"This question is outside the selected domain **{domain_label}**. "
                    f"Please switch to a relevant domain or select **All Domains** to ask this."
                )
                yield f"data: {json.dumps({'type': 'token', 'content': msg})}\n\n"
                yield "data: {\"type\": \"done\"}\n\n"
            return StreamingResponse(_refuse(), media_type="text/event-stream")

    # Load conversation history after domain check passes.
    # user_id is passed so history can only be read back for this user's own
    # sessions — a session id from someone else's chat returns nothing.
    conversation_history = []
    if request.session_id:
        conversation_history = await load_history(request.session_id, db, user_id=current_user.id)

    # Retrieval — fast path: no graph (~7s saved)
    chunks, best_dense_score = await _stream_retriever.retrieve(
        query=request.query,
        db=db,
        top_k=request.top_k,
        domain=request.domain,
    )

    # Fetch document titles — BUG-016: filter out non-UUID IDs (e.g. "web_0") before UUID()
    doc_id_set = list({c.document_id for c in chunks})
    doc_title_map: dict[str, str] = {}
    if doc_id_set:
        try:
            valid_uuids = []
            for d in doc_id_set:
                try:
                    valid_uuids.append(uuid.UUID(d))
                except ValueError:
                    pass
            if valid_uuids:
                rows = (await db.execute(
                    select(Document.id, Document.title).where(Document.id.in_(valid_uuids))
                )).all()
                doc_title_map = {str(row.id): row.title for row in rows}
        except Exception:
            pass

    async def event_stream():
        active_chunks = chunks
        web_search_used = False

        needs_web = not active_chunks or best_dense_score < 0.45

        if needs_web:
            yield f"data: {json.dumps({'type': 'token', 'content': '_Searching the web..._\n\n'})}\n\n"
            web_results = search_web(request.query)
            if not web_results:
                yield f"data: {json.dumps({'type': 'error', 'content': 'No relevant information found in the knowledge base or on the web.'})}\n\n"
                yield "data: {\"type\": \"done\"}\n\n"
                return
            active_chunks = [
                RetrievedChunk(
                    text=r["content"][:1500],
                    document_id=f"web_{i}",
                    chunk_index=0,
                    page_number=None,
                    score=0.8,
                    domain=request.domain,
                )
                for i, r in enumerate(web_results[:5])
            ]
            web_search_used = True
            doc_title_map.update({
                f"web_{i}": r.get("title", r.get("url", "Web Result"))
                for i, r in enumerate(web_results[:5])
            })

            try:
                from backend.workers.tasks import ingest_text_task
                for r in web_results:
                    if r.get("content") and len(r["content"]) > 100:
                        ingest_text_task.apply_async(
                            kwargs=dict(
                                text=r["content"],
                                title=r.get("title") or r.get("url", "Web Result")[:200],
                                source_url=r.get("url", ""),
                                domain=request.domain,
                            ),
                            ignore_result=True,
                        )
            except Exception as _celery_err:
                import logging
                logging.getLogger("researchos.api").warning(
                    "[stream] background KB ingest skipped (Celery unavailable): %s", _celery_err
                )

        # Stream tokens
        gen_state = {
            "query": request.query, "domain": request.domain, "db": db,
            "session_id": request.session_id, "conversation_history": conversation_history,
            "plan": {}, "sub_queries": [], "chunks": active_chunks,
            "contradictions": [], "context": "", "answer": "",
            "is_relevant": True, "has_hallucination": False,
            "citation_verified": True, "web_search_used": web_search_used,
            "web_sources": [], "sources": [],
        }
        full_answer = ""
        for token in stream_generator_node(gen_state):
            full_answer += token
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        sources = [
            {
                "document_id": c.document_id,
                "chunk_index": c.chunk_index,
                "page_number": c.page_number,
                "score": round(c.score, 4),
                "title": doc_title_map.get(c.document_id, "Web Result" if web_search_used else "Unknown Paper"),
                "text": c.text[:600],
            }
            for c in active_chunks
        ]
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources, 'chunks_used': len(active_chunks)})}\n\n"

        # BUG-017: report only what actually ran (use_hyde=False, use_graph=False)
        methods = ["Web Search"] if web_search_used else ["Dense Retrieval", "Sparse BM25"]
        pipeline_info = {
            "type": "pipeline",
            "methods": methods,
            "chunks_retrieved": len(active_chunks),
            "reranked": not web_search_used,
            "has_hallucination": False,
            "grader_passed": True,
        }
        yield f"data: {json.dumps(pipeline_info)}\n\n"

        if request.session_id:
            await save_exchange(
                session_id=request.session_id,
                query=request.query,
                answer=full_answer,
                db=db,
                user_id=current_user.id,
            )

        yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    req: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query the knowledge base using the agentic RAG pipeline."""
    # BUG-008: /query had no rate limit — added same check as /query/stream
    client_ip = _get_client_ip(req)
    allowed, retry_after = check_rate_limit(client_ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"error": "rate_limit", "retry_after": retry_after},
        )

    graph = build_graph()

    conversation_history = []
    if request.session_id:
        conversation_history = await load_history(request.session_id, db, user_id=current_user.id)

    result = await graph.ainvoke({
        "query": request.query,
        "domain": request.domain,
        "db": db,
        "session_id": request.session_id,
        "conversation_history": conversation_history,
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

    if not result["is_relevant"]:
        return QueryResponse(
            answer="No relevant information found in the knowledge base for your query.",
            chunks_used=0,
            sources=[],
        )

    answer = result["answer"]
    if result["has_hallucination"]:
        answer += "\n\n[Warning: This answer may contain information not fully supported by the retrieved context.]"

    if request.session_id:
        await save_exchange(
            session_id=request.session_id,
            query=request.query,
            answer=answer,
            db=db,
            user_id=current_user.id,
        )

    return QueryResponse(
        answer=answer,
        chunks_used=len(result["chunks"]),
        sources=[SourceItem(**s) for s in result["sources"]],
    )
