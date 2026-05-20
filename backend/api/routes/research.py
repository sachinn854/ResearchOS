from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.report_generator import ReportGenerator
from backend.api.schemas.research import (
    IngestRequest,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    SourceItem,
)
from backend.db.postgres import get_db
from backend.ingestion.pipeline import ingest_document

router = APIRouter(prefix="/research", tags=["research"])


@router.post("/ingest", response_model=IngestResponse)
async def ingest(request: IngestRequest, db: AsyncSession = Depends(get_db)):
    doc = await ingest_document(
        source=request.source,
        title=request.title,
        db=db,
        domain=request.domain,
    )
    return IngestResponse(
        document_id=str(doc.id),
        title=doc.title,
        status=doc.status,
    )


@router.post("/query", response_model=QueryResponse)
def query(request: QueryRequest):
    generator = ReportGenerator()
    result = generator.generate(
        query=request.query,
        top_k=request.top_k,
        domain=request.domain,
    )
    return QueryResponse(
        answer=result.answer,
        chunks_used=result.chunks_used,
        sources=[SourceItem(**s) for s in result.sources],
    )
