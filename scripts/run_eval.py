"""
Evaluate the RAG pipeline against a golden question set.

Every question is answered by the real agent graph (the same one the
/research/query endpoint uses), then graded by an LLM judge on four metrics.
See backend/evaluation/evaluator.py for what each metric means.

Usage:
    python -m scripts.run_eval

Requires a populated knowledge base — run scripts/seed_kb.py or
scripts/arxiv_ingest.py first, otherwise every context metric will be 0.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from backend.db.postgres import AsyncSessionLocal
from backend.evaluation.evaluator import RAGEvaluator
from backend.evaluation.schemas import EvalSample

# Golden dataset — questions with hand-written reference answers.
#
# These are deliberately about RAG itself, because that is what the seeded
# knowledge base contains (see data/arxiv_papers/). A golden set only measures
# retrieval honestly if the answers are actually present in the corpus; asking
# about topics the KB never ingested measures nothing but produces confident 0s.
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
    EvalSample(
        question="Why is chunk size a trade-off in RAG?",
        ground_truth=(
            "Small chunks embed precisely and give sharp retrieval, but they can be cut off from "
            "the surrounding context an answer needs. Large chunks keep more context but their "
            "embedding averages several topics together, which blurs the vector and makes "
            "retrieval less precise. Overlap between chunks reduces the risk of splitting a fact "
            "across a boundary, at the cost of storing duplicated text."
        ),
    ),
    EvalSample(
        question="What is a cross-encoder reranker and why is it used after retrieval?",
        ground_truth=(
            "A cross-encoder takes the query and a candidate passage together as one input and "
            "outputs a relevance score, so it can model the interaction between them. That makes "
            "it more accurate than the bi-encoder used for first-stage retrieval, which embeds "
            "query and passage separately. It is far too slow to score a whole corpus, so it is "
            "used as a second stage: the fast retriever fetches a few dozen candidates and the "
            "cross-encoder reorders them, which mainly improves precision at the top ranks."
        ),
    ),
    EvalSample(
        question="What is HyDE in retrieval?",
        ground_truth=(
            "HyDE stands for Hypothetical Document Embeddings. Instead of embedding the user's "
            "short query directly, an LLM first writes a hypothetical answer to it, and that "
            "generated passage is embedded and used for the vector search. It helps because a "
            "hypothetical answer looks much more like the documents being searched than a short "
            "question does, which closes the vocabulary gap between queries and passages."
        ),
    ),
    EvalSample(
        question="How do RAG systems reduce hallucination?",
        ground_truth=(
            "Grounding the answer in retrieved passages is the main defence: the model is "
            "instructed to answer only from the provided context and to say when the context is "
            "insufficient. On top of that, systems add citations linking claims back to specific "
            "chunks, a verification step that checks whether each claim is supported by the "
            "context, and a confidence threshold that refuses or falls back to search when "
            "retrieval quality is too low."
        ),
    ),
    EvalSample(
        question="What makes multi-hop questions hard for RAG?",
        ground_truth=(
            "A multi-hop question needs facts from more than one document combined through "
            "intermediate reasoning. Single-shot retrieval fails because no individual chunk is "
            "similar to the whole question, and the bridging entity that links the pieces only "
            "appears after the first hop. Systems address this by decomposing the question into "
            "sub-questions, or by retrieving iteratively so that each hop's result informs the "
            "next query."
        ),
    ),
    EvalSample(
        question="What is graph-based retrieval in RAG?",
        ground_truth=(
            "Graph-based retrieval builds a graph of entities and the relationships between them "
            "extracted from the corpus, rather than treating chunks as independent passages. "
            "Retrieval then traverses that graph, so chunks that share entities with the query "
            "can be pulled in even when their wording is not similar. It is particularly useful "
            "for multi-hop questions and for summarising a topic that is spread across many "
            "documents."
        ),
    ),
    EvalSample(
        question="Which metrics are used to evaluate RAG systems?",
        ground_truth=(
            "RAG evaluation separates retrieval quality from generation quality. On the retrieval "
            "side, context recall measures whether the passages needed to answer were retrieved, "
            "and context precision measures what fraction of retrieved passages were useful. On "
            "the generation side, faithfulness measures whether the answer's claims are supported "
            "by the retrieved context, and answer relevancy measures whether the answer addresses "
            "the question. Ranking metrics such as nDCG, MRR and recall@k are also used for the "
            "retriever alone."
        ),
    ),
    EvalSample(
        question="What is HNSW and why do vector databases use it?",
        ground_truth=(
            "HNSW (Hierarchical Navigable Small World) is an approximate nearest-neighbour index "
            "built as a multi-layer graph of vectors. Search starts in a sparse top layer to jump "
            "close to the target region and descends into denser layers to refine, giving roughly "
            "logarithmic search time. Vector databases use it because an exact scan over millions "
            "of vectors is too slow, and HNSW trades a small, tunable amount of recall for a very "
            "large speed gain."
        ),
    ),
]


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    os.makedirs("reports", exist_ok=True)

    print(f"\nEvaluating {len(EVAL_SAMPLES)} samples through the full agent graph...")
    print("Each sample costs 1 pipeline run + 4 judge calls.\n")

    evaluator = RAGEvaluator()

    async with AsyncSessionLocal() as db:
        results = await evaluator.run(EVAL_SAMPLES, db=db)

    print("\n" + "=" * 68)
    print("Per-sample scores")
    print("=" * 68)

    metrics = ["faithfulness", "answer_relevancy", "context_recall", "context_precision"]
    collected: dict[str, list[float]] = {metric: [] for metric in metrics}
    report_rows = []

    for sample, result in zip(EVAL_SAMPLES, results):
        summary = result.summary()
        print(f"\nQ: {sample.question}")
        print(f"   chunks retrieved: {len(sample.contexts)}")
        for metric in metrics:
            score = summary[metric]
            print(f"   {metric:<20} {'n/a' if score is None else f'{score:.3f}'}")
            if score is not None:
                collected[metric].append(score)

        report_rows.append({
            "question": sample.question,
            "chunks_retrieved": len(sample.contexts),
            "answer_chars": len(sample.answer),
            **summary,
        })

    print("\n" + "=" * 68)
    print("Averages")
    print("=" * 68)

    averages = {}
    for metric in metrics:
        values = collected[metric]
        average = round(sum(values) / len(values), 4) if values else None
        averages[metric] = average
        # Print how many samples the average came from. An average over 3 of 12
        # samples is not comparable to one over all 12, and hiding that is how
        # eval numbers start lying.
        coverage = f"({len(values)}/{len(EVAL_SAMPLES)} samples)"
        shown = "n/a" if average is None else f"{average:.4f}"
        print(f"  {metric:<20} {shown:<8} {coverage}")

    failed = sum(1 for sample in EVAL_SAMPLES if not sample.contexts)
    if failed:
        print(f"\n  WARNING: {failed}/{len(EVAL_SAMPLES)} samples retrieved no context at all.")
        print("  Is the knowledge base populated? Try: python -m scripts.seed_kb")

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "judge_model": evaluator.judge_model,
        "sample_count": len(EVAL_SAMPLES),
        "averages": averages,
        "coverage": {metric: len(collected[metric]) for metric in metrics},
        "samples": report_rows,
    }

    report_path = "reports/eval_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport saved -> {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
