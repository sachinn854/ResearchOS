from dataclasses import dataclass, field

from groq import Groq
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.prompts.report import build_report_prompt
from backend.retrieval.context_assembler import ContextAssembler
from backend.retrieval.dense_retriever import RetrievedChunk
from backend.retrieval.hybrid_retriever import HybridRetriever


@dataclass
class ReportResult:
    answer: str
    chunks_used: int
    sources: list[dict] = field(default_factory=list)


class ReportGenerator:
    def __init__(self):
        self.retriever = HybridRetriever()
        self.assembler = ContextAssembler()
        self.client = Groq(api_key=settings.groq_api_key)

    async def generate(
        self,
        query: str,
        db: AsyncSession,
        top_k: int = 5,
        domain: str | None = None,
    ) -> ReportResult:
        """Retrieve chunks via hybrid retrieval and generate an answer using Groq."""

        # Step 1: Hybrid retrieve (dense + sparse + RRF + rerank)
        chunks: list[RetrievedChunk] = await self.retriever.retrieve(
            query, db=db, top_k=top_k, domain=domain
        )

        if not chunks:
            return ReportResult(
                answer="No relevant information found in the knowledge base.",
                chunks_used=0,
            )

        # Step 2: Assemble context
        context = self.assembler.assemble(chunks)

        # Step 3: Build prompt
        prompt = build_report_prompt(context=context, question=query)

        # Step 4: Call Groq
        response = self.client.chat.completions.create(
            model=settings.groq_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )

        answer = response.choices[0].message.content

        sources = [
            {
                "document_id": c.document_id,
                "chunk_index": c.chunk_index,
                "page_number": c.page_number,
                "score": round(c.score, 4),
            }
            for c in chunks
        ]

        return ReportResult(answer=answer, chunks_used=len(chunks), sources=sources)
