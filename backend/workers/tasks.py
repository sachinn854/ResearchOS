import asyncio
import logging

from backend.workers.celery_app import QUEUE_BACKGROUND, QUEUE_INGEST, celery_app

log = logging.getLogger("researchos.workers.tasks")


# BUG-022: added max_retries + retry_backoff so transient failures (Qdrant down,
# LLM 429) retry automatically instead of leaving documents stuck in "processing".
#
# PENDING #9: routed to the `ingest` queue. A user is polling
# /research/tasks/{id} for this, so it must not queue behind background work.
@celery_app.task(
    name="ingest_document",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    queue=QUEUE_INGEST,
)
def ingest_document_task(self, source: str, title: str, domain: str | None = None) -> dict:
    """Background task — parse, chunk, embed, and store a document."""
    log.info("[task] ingest_document started | title=%r | source=%s", title, source)

    async def _run() -> dict:
        from backend.db.postgres import AsyncSessionLocal
        from backend.db.qdrant_client import init_collection
        from backend.ingestion.pipeline import ingest_document

        init_collection()
        async with AsyncSessionLocal() as db:
            doc = await ingest_document(source=source, title=title, db=db, domain=domain)
            return {"document_id": str(doc.id), "title": doc.title, "status": doc.status}

    try:
        result = asyncio.run(_run())
        log.info("[task] ingest_document done | document_id=%s | status=%s",
                 result["document_id"], result["status"])
        return result
    except Exception as exc:
        log.error("[task] ingest_document failed | source=%s | error=%s", source, exc)
        # Retry with exponential backoff — raises Retry which Celery handles
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))


# PENDING #9: routed to the `background` queue. Nobody is waiting on this — it is
# the Adaptive KB storing web results for future queries — so it must never make a
# user-triggered upload wait.
@celery_app.task(
    name="ingest_text",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    queue=QUEUE_BACKGROUND,
)
def ingest_text_task(
    self,
    text: str,
    title: str,
    source_url: str = "",
    domain: str | None = None,
) -> dict:
    """Background task — ingest raw text (e.g. from web search) into the KB."""
    log.info("[task] ingest_text started | title=%r", title)

    async def _run() -> dict:
        import tempfile, os
        from backend.db.postgres import AsyncSessionLocal
        from backend.db.qdrant_client import init_collection
        from backend.ingestion.pipeline import ingest_document

        init_collection()

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
            f.write(f"Source: {source_url}\n\n{text}")
            tmp_path = f.name

        try:
            async with AsyncSessionLocal() as db:
                doc = await ingest_document(source=tmp_path, title=title, db=db, domain=domain)
                return {"document_id": str(doc.id), "status": doc.status}
        finally:
            os.unlink(tmp_path)

    try:
        result = asyncio.run(_run())
        log.info("[task] ingest_text done | document_id=%s", result["document_id"])
        return result
    except Exception as exc:
        log.error("[task] ingest_text failed | title=%r | error=%s", title, exc)
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))
