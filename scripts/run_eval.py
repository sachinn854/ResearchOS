"""
Run RAGAS evaluation on a golden question set.

Usage:
    python -m scripts.run_eval
"""

import asyncio
import json
import os
from datetime import datetime, timezone

from backend.db.postgres import AsyncSessionLocal
from backend.evaluation.evaluator import RAGEvaluator
from backend.evaluation.schemas import EvalSample

# Golden dataset — manually written ground truth answers
EVAL_SAMPLES = [
    EvalSample(
        question="What is RAG and how does it work?",
        ground_truth=(
            "RAG (Retrieval-Augmented Generation) combines information retrieval with "
            "large language model generation. It embeds a query into a vector, searches "
            "a vector database for the most similar document chunks, and uses those chunks "
            "as context for the LLM to generate an accurate, grounded answer."
        ),
    ),
    EvalSample(
        question="What is dense retrieval?",
        ground_truth=(
            "Dense retrieval uses vector embeddings to find semantically similar documents. "
            "Each chunk is converted into a high-dimensional vector and approximate "
            "nearest-neighbour algorithms like HNSW are used to find the closest vectors at query time."
        ),
    ),
    EvalSample(
        question="What is hybrid retrieval and what is RRF?",
        ground_truth=(
            "Hybrid retrieval combines dense vector search with sparse keyword search such as "
            "BM25 or PostgreSQL full-text search. Results from both are fused using "
            "Reciprocal Rank Fusion (RRF), which balances exact keyword matches with semantic similarity."
        ),
    ),
    EvalSample(
        question="What are chunking strategies in RAG?",
        ground_truth=(
            "Chunking strategies determine how documents are split before embedding. "
            "Recursive character splitting is a good default for plain text and PDFs. "
            "Markdown-aware splitting respects heading boundaries. "
            "Semantic chunking uses embeddings to detect topic shifts and create more coherent chunks."
        ),
    ),
]


async def main() -> None:
    os.makedirs("reports", exist_ok=True)

    print(f"\nRunning RAGAS evaluation on {len(EVAL_SAMPLES)} samples...\n")
    evaluator = RAGEvaluator()

    async with AsyncSessionLocal() as db:
        results = await evaluator.run(EVAL_SAMPLES, db=db)

    print("\nRAGAS Evaluation Results")
    print("=" * 60)

    all_scores = {"faithfulness": [], "answer_relevancy": [], "context_recall": [], "context_precision": []}

    report_rows = []
    for sample, result in zip(EVAL_SAMPLES, results):
        summary = result.summary()
        print(f"\nQ: {sample.question}")
        for metric, score in summary.items():
            print(f"  {metric:<30} {score}")
            if score is not None:
                all_scores[metric].append(score)

        report_rows.append({"question": sample.question, **summary})

    print("\n" + "=" * 60)
    print("Averages:")
    averages = {}
    for metric, values in all_scores.items():
        avg = round(sum(values) / len(values), 4) if values else None
        averages[metric] = avg
        print(f"  {metric:<30} {avg}")

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "averages": averages,
        "samples": report_rows,
    }

    report_path = "reports/eval_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport saved → {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
