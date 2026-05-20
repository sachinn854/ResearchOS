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
from backend.ingestion.embedding.embedding_service import EmbeddingService


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
        case "pdf":  return PDFParser()
        case "docx": return DOCXParser()
        case "web":  return WebParser()
        case _:      return TXTParser()


async def ingest_document(
    source: str,
    title: str,
    db: AsyncSession,
    domain: str | None = None,
) -> Document:
    """Full ingestion pipeline: parse → chunk → embed → store in Qdrant + Postgres."""

    doc_type = _detect_type(source)
    parser = _get_parser(doc_type)
    chunker = get_chunker(doc_type)
    embedder = EmbeddingService()

    # Step 1: Parse
    pages = parser.parse(source)

    # Step 2: Chunk
    text_chunks = chunker.chunk(pages)

    # Step 3: Embed all chunks in one batch call
    vectors = embedder.embed([c.text for c in text_chunks])

    # Step 4: Save Document row first (need doc.id for FK)
    doc = Document(title=title, source_path=source, domain=domain, status="processing")
    db.add(doc)
    await db.flush()

    # Step 5: Build Qdrant points and Postgres chunk rows
    qdrant_points: list[PointStruct] = []
    db_chunks: list[Chunk] = []

    for chunk, vector in zip(text_chunks, vectors):
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

    # Step 6: Upsert vectors into Qdrant
    qdrant_client.upsert(
        collection_name=settings.qdrant_collection,
        points=qdrant_points,
    )

    # Step 7: Bulk insert chunks and mark document as completed
    db.add_all(db_chunks)
    doc.status = "completed"
    await db.commit()
    await db.refresh(doc)

    return doc
