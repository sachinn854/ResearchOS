from groq import Groq
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from ragas import EvaluationDataset, SingleTurnSample, evaluate
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import AnswerRelevancy, Faithfulness, LLMContextPrecisionWithReference, LLMContextRecall
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.evaluation.schemas import EvalResult, EvalSample
from backend.prompts.report import build_report_prompt
from backend.retrieval.context_assembler import ContextAssembler
from backend.retrieval.hybrid_retriever import HybridRetriever


class RAGEvaluator:
    def __init__(self):
        langchain_llm = ChatGroq(model=settings.groq_model, api_key=settings.groq_api_key)
        langchain_emb = HuggingFaceEmbeddings(model_name=settings.embedding_model)

        self.ragas_llm = LangchainLLMWrapper(langchain_llm)
        self.ragas_emb = LangchainEmbeddingsWrapper(langchain_emb)

        self.metrics = [
            Faithfulness(llm=self.ragas_llm),
            AnswerRelevancy(llm=self.ragas_llm, embeddings=self.ragas_emb),
            LLMContextRecall(llm=self.ragas_llm),
            LLMContextPrecisionWithReference(llm=self.ragas_llm),
        ]

        self.retriever = HybridRetriever()
        self.assembler = ContextAssembler()
        self.groq = Groq(api_key=settings.groq_api_key)

    async def _run_single(self, question: str, db: AsyncSession) -> tuple[str, list[str]]:
        """Run full RAG pipeline for one question. Returns (answer, context_texts)."""
        chunks = await self.retriever.retrieve(question, db=db)
        context = self.assembler.assemble(chunks)
        prompt = build_report_prompt(context=context, question=question)

        response = self.groq.chat.completions.create(
            model=settings.groq_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )

        answer = response.choices[0].message.content
        context_texts = [c.text for c in chunks]
        return answer, context_texts

    async def run(self, samples: list[EvalSample], db: AsyncSession) -> list[EvalResult]:
        """Run the full pipeline for each sample, then evaluate with RAGAS."""
        ragas_samples = []

        for sample in samples:
            answer, context_texts = await self._run_single(sample.question, db=db)

            ragas_samples.append(SingleTurnSample(
                user_input=sample.question,
                response=answer,
                retrieved_contexts=context_texts,
                reference=sample.ground_truth,
            ))

        dataset = EvaluationDataset(samples=ragas_samples)
        scores = evaluate(dataset=dataset, metrics=self.metrics)
        df = scores.to_pandas()

        # Column names vary across RAGAS versions — check both forms
        recall_col = next((c for c in df.columns if "recall" in c.lower()), None)
        precision_col = next((c for c in df.columns if "precision" in c.lower()), None)

        results = []
        for _, row in df.iterrows():
            results.append(EvalResult(
                faithfulness=row.get("faithfulness"),
                answer_relevancy=row.get("answer_relevancy"),
                context_recall=row[recall_col] if recall_col else None,
                context_precision=row[precision_col] if precision_col else None,
            ))

        return results
