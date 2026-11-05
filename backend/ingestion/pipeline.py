import asyncio
import hashlib
import logging
import os
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from qdrant_client.models import PointStruct

from backend.core.config import settings
from backend.db.models.document import Document
from backend.db.models.chunk import Chunk
from backend.db.qdrant_client import client as qdrant_client
from backend.ingestion.parsers.pdf_parser import PDFParser
from backend.ingestion.parsers.docx_parser import DOCXParser
from backend.ingestion.parsers.txt_parser import TXTParser
from backend.ingestion.parsers.web_parser import WebParser
from backend.ingestion.parsers.base import BaseParser
from backend.ingestion.chunking.factory import get_chunker
from backend.ingestion.embedding.embedding_service import get_embedder
from backend.ingestion.cleaning.text_cleaner import clean_page_text, is_clean_chunk
from backend.ingestion.graph.entity_extractor import extract_entities_for_chunks
from sqlalchemy import select

log = logging.getLogger("researchos.ingestion.pipeline")

# How many vectors go in one Qdrant request. 384-dim vector plus the chunk text
# in the payload is a few KB per point, so 64 keeps each request small enough to
# finish comfortably inside the client timeout.
QDRANT_UPSERT_BATCH = 64

def _detect_type(source: str) -> str:
    if source.startswith("http://") or source.startswith("https://"):
        return "web"
    ext = os.path.splitext(source)[1].lower()
    match ext:
        case ".pdf":  return "pdf"
        case ".docx": return "docx"
        case ".md":   return "md"
        case _:       return "txt"


def _get_parser(doc_type: str) -> BaseParser:
    match doc_type:
        case "pdf":  return PDFParser(extract_images=settings.enable_image_description)
        case "docx": return DOCXParser()
        case "web":  return WebParser()
        case _:      return TXTParser()


def _compute_hash(source: str) -> str | None:
    """SHA-256 hash of a local file. Returns None for URLs."""
    if source.startswith("http://") or source.startswith("https://"):
        return None
    try:
        h = hashlib.sha256()
        with open(source, "rb") as f:
            for block in iter(lambda: f.read(65536), b""):
                h.update(block)
        return h.hexdigest()
    except OSError:
        return None


async def ingest_document(
    source: str,
    title: str,
    db: AsyncSession,
    domain: str | None = None,
) -> Document:
    """Full ingestion pipeline: parse → chunk → embed → store in Qdrant + Postgres."""

    doc_type = _detect_type(source)
    log.info("[pipeline] starting | title=%r | type=%s | domain=%s", title, doc_type, domain)

    # Hash deduplication — skip if already ingested
    file_hash = _compute_hash(source)
    if file_hash:
        existing = await db.scalar(
            select(Document).where(Document.file_hash == file_hash)
        )
        if existing:
            log.info("[pipeline] duplicate detected (hash=%s) — skipping | id=%s", file_hash[:12], existing.id)
            # BUG-025: update title if it changed on re-upload
            if existing.title != title:
                existing.title = title
                await db.commit()
            return existing

    parser = _get_parser(doc_type)
    chunker = get_chunker(doc_type)
    # BUG-013: one model per process, not per request. Now shared with retrieval
    # too, so the API and the worker each hold exactly one copy.
    embedder = get_embedder()

    # Step 1: Parse
    log.info("[pipeline] step 1/8 — parsing...")
    pages = parser.parse(source)
    log.info("[pipeline] parsed %d pages", len(pages))

    # Step 2: Clean pages (remove noise before chunking)
    log.info("[pipeline] step 2/8 — cleaning %d pages...", len(pages))
    for page in pages:
        # Postgres TEXT cannot store null byte \x00 — strip it early so a single
        # PDF with binary artefacts does not poison the whole ingest session
        page.text = clean_page_text(page.text.replace("\x00", ""))
    pages = [p for p in pages if p.text.strip()]
    log.info("[pipeline] %d pages remain after cleaning", len(pages))

    # Step 3: Chunk
    log.info("[pipeline] step 3/8 — chunking...")
    text_chunks = chunker.chunk(pages)
    raw_count = len(text_chunks)

    # Step 4: Filter low-quality chunks
    log.info("[pipeline] step 4/8 — filtering chunks...")
    text_chunks = [c for c in text_chunks if is_clean_chunk(c.text)]
    log.info("[pipeline] kept %d/%d chunks after filter", len(text_chunks), raw_count)

    # BUG-003: empty chunk list means the document had no extractable text (e.g. scanned PDF)
    if not text_chunks:
        log.warning("[pipeline] no usable chunks extracted — document will be marked failed | source=%s", source)
        doc = Document(title=title, source_path=source, domain=domain, status="failed", file_hash=file_hash)
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
        return doc

    # Step 5: Embed
    log.info("[pipeline] step 5/8 — embedding %d chunks...", len(text_chunks))
    vectors = embedder.embed([c.text for c in text_chunks])
    log.info("[pipeline] embedded %d vectors (dim=%d)", len(vectors), len(vectors[0]))

    # Step 6: Entities for the graph retrieval signal.
    # BUG-014: this used to sit inside the loop below as a blocking, one-call-
    # per-chunk operation. Now it is one batched, concurrent, off-the-event-loop
    # pass that returns a list parallel to text_chunks.
    log.info("[pipeline] step 6/8 — extracting entities...")
    entities_per_chunk = await extract_entities_for_chunks([c.text for c in text_chunks])

    # Step 7: Save Document row + chunks to Postgres first
    log.info("[pipeline] step 7/8 — saving to Postgres...")
    doc = Document(title=title, source_path=source, domain=domain, status="processing", file_hash=file_hash)
    db.add(doc)
    await db.flush()
    log.info("[pipeline] document saved | id=%s", doc.id)

    # Step 8: Build Qdrant points and Postgres chunk rows
    qdrant_points: list[PointStruct] = []
    db_chunks: list[Chunk] = []

    for chunk, vector, entities in zip(text_chunks, vectors, entities_per_chunk):
        qdrant_id = str(uuid.uuid4())

        qdrant_points.append(PointStruct(
            id=qdrant_id,
            vector=vector,
            payload={
                "document_id": str(doc.id),
                "chunk_index": chunk.chunk_index,
                "page_number": chunk.page_number,
                "text": chunk.text,
                "domain": domain,
                "entities": entities,
                "chunk_type": "base",
            },
        ))

        db_chunks.append(Chunk(
            document_id=doc.id,
            text=chunk.text,
            chunk_index=chunk.chunk_index,
            page_number=chunk.page_number,
            word_count=chunk.word_count,
            qdrant_id=qdrant_id,
        ))

    # BUG-004: commit Postgres FIRST — if Qdrant fails after, we can mark doc failed.
    # Previous order (Qdrant first, Postgres second) left orphan vectors on Postgres failure.
    log.info("[pipeline] step 8/8 — committing %d chunks to Postgres...", len(db_chunks))
    db.add_all(db_chunks)
    doc.status = "completed"
    await db.commit()
    await db.refresh(doc)

    # BUG-015: Qdrant upsert is synchronous — wrap in thread to avoid blocking the event loop
    log.info("[pipeline] upserting %d vectors to Qdrant...", len(qdrant_points))
    try:
        # Upsert in batches. One request carrying 300+ vectors times out against
        # Qdrant Cloud, and because Postgres is already committed by this point a
        # timeout leaves the document with text in the sparse index and nothing
        # in the dense one.
        for start in range(0, len(qdrant_points), QDRANT_UPSERT_BATCH):
            batch = qdrant_points[start:start + QDRANT_UPSERT_BATCH]
            await asyncio.to_thread(
                qdrant_client.upsert,
                collection_name=settings.qdrant_collection,
                points=batch,
            )
            log.debug("[pipeline] upserted %d/%d vectors", start + len(batch), len(qdrant_points))
    except Exception as exc:
        log.error("[pipeline] Qdrant upsert failed — marking document as failed | id=%s | error=%s", doc.id, exc)
        doc.status = "failed"
        await db.commit()
        return doc

    log.info("[pipeline] done | id=%s | chunks=%d | status=%s", doc.id, len(db_chunks), doc.status)
    return doc
