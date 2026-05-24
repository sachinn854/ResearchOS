import json

from celery.result import AsyncResult
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.graph import build_graph
from backend.agents.nodes import grader_node, hallucination_checker_node, stream_generator_node
from backend.retrieval.hybrid_retriever import HybridRetriever
from backend.retrieval.context_assembler import ContextAssembler

_retriever = HybridRetriever()
_assembler = ContextAssembler()
from backend.api.schemas.research import (
    AsyncIngestResponse,
    IngestRequest,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    SourceItem,
    TaskStatusResponse,
)
from backend.db.postgres import get_db
from backend.ingestion.pipeline import ingest_document
from backend.memory.conversation_store import load_history, save_exchange
from backend.workers.celery_app import celery_app

router = APIRouter(prefix="/research", tags=["research"])


@router.post("/ingest", response_model=IngestResponse)
async def ingest(request: IngestRequest, db: AsyncSession = Depends(get_db)):
    """Synchronous ingest — waits until complete. Good for small files."""
    doc = await ingest_document(
        source=request.source,
        title=request.title,
        db=db,
        domain=request.domain,
    )
    return IngestResponse(document_id=str(doc.id), title=doc.title, status=doc.status)


@router.post("/ingest/async", response_model=AsyncIngestResponse)
async def ingest_async(request: IngestRequest):
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
async def get_task_status(task_id: str):
    """Check the status of a background ingestion task."""
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
async def query_stream(request: QueryRequest, db: AsyncSession = Depends(get_db)):
    """Streaming query — tokens arrive in real-time via Server-Sent Events."""

    conversation_history = []
    if request.session_id:
        conversation_history = await load_history(request.session_id, db)

    # Retrieval (non-streaming, fast)
    chunks = await _retriever.retrieve(
        query=request.query,
        db=db,
        top_k=5,
        domain=request.domain,
    )

    async def event_stream():
        # No chunks → not relevant
        if not chunks:
            yield f"data: {json.dumps({'type': 'error', 'content': 'No relevant information found in the knowledge base.'})}\n\n"
            yield "data: {\"type\": \"done\"}\n\n"
            return

        # Grader check
        state = {
            "query": request.query,
            "domain": request.domain,
            "db": db,
            "session_id": request.session_id,
            "conversation_history": conversation_history,
            "plan": {},
            "sub_queries": [],
            "chunks": chunks,
            "contradictions": [],
            "context": "",
            "answer": "",
            "is_relevant": True,
            "has_hallucination": False,
            "citation_verified": True,
            "web_search_used": False,
            "web_sources": [],
            "sources": [],
        }
        grader_result = grader_node(state)
        if not grader_result["is_relevant"]:
            yield f"data: {json.dumps({'type': 'error', 'content': 'No relevant information found in the knowledge base.'})}\n\n"
            yield "data: {\"type\": \"done\"}\n\n"
            return

        # Stream tokens
        full_answer = ""
        for token in stream_generator_node(state):
            full_answer += token
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        # Hallucination check on complete answer
        state["answer"] = full_answer
        state["context"] = _assembler.assemble(chunks)
        hc_result = hallucination_checker_node(state)
        if hc_result["has_hallucination"]:
            warning = "\n\n[Warning: This answer may contain information not fully supported by the retrieved context.]"
            yield f"data: {json.dumps({'type': 'token', 'content': warning})}\n\n"
            full_answer += warning

        # Send sources
        sources = [
            {
                "document_id": c.document_id,
                "chunk_index": c.chunk_index,
                "page_number": c.page_number,
                "score": round(c.score, 4),
            }
            for c in chunks
        ]
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources, 'chunks_used': len(chunks)})}\n\n"

        # Save to memory
        if request.session_id:
            await save_exchange(
                session_id=request.session_id,
                query=request.query,
                answer=full_answer,
                db=db,
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
async def query(request: QueryRequest, db: AsyncSession = Depends(get_db)):
    """Query the knowledge base using the agentic RAG pipeline."""
    graph = build_graph()

    # Load conversation history if session_id provided
    conversation_history = []
    if request.session_id:
        conversation_history = await load_history(request.session_id, db)

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

    # Persist this exchange to memory
    if request.session_id:
        await save_exchange(
            session_id=request.session_id,
            query=request.query,
            answer=answer,
            db=db,
        )

    return QueryResponse(
        answer=answer,
        chunks_used=len(result["chunks"]),
        sources=[SourceItem(**s) for s in result["sources"]],
    )
