# ResearchOS

A production-grade, learning-focused RAG (Retrieval-Augmented Generation) platform built from scratch. Designed to deeply understand every layer of modern RAG systems — from dense retrieval to agentic pipelines.

---

## What It Does

ResearchOS lets you ingest research papers and ask questions about them. Instead of reading 20 papers manually, you ask a question and the system synthesizes answers from your knowledge base.

```
You: "What are the main approaches to reduce hallucinations in RAG?"

ResearchOS: [reads 5 relevant chunks from ingested papers]
  "Three main approaches exist:
   1. Retrieval grounding — constrain LLM to context only [1]
   2. Hallucination detection — checker agent flags ungrounded claims [2]
   3. RAPTOR summaries — broad cluster summaries for better coverage [3]"
```

---

## Architecture

```
[User Query]
     ↓
[Planner Agent]          ← decides approach, generates sub-queries
     ↓
[Hybrid Retriever]
  ├── HyDE Dense (Qdrant)    ← hypothetical document embedding
  ├── Sparse BM25 (Postgres) ← keyword full-text search
  └── Graph Entity (Qdrant)  ← entity-overlap matching
     ↓
[RRF Fusion + Cross-Encoder Reranking]
     ↓
[Grader Agent]           ← relevant? → continue / no → web search
     ↓
[Contradiction Detector] ← flags conflicting claims between chunks
     ↓
[Generator]              ← Groq LLM, streaming SSE response
     ↓
[Citation Verifier]      ← checks [1][2] citations against source chunks
     ↓
[Hallucination Checker]  ← answer grounded in context?
     ↓
[Streaming Response]
```

Full flow diagrams → [`Architecture/FLOW_DIAGRAM.md`](Architecture/FLOW_DIAGRAM.md)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI + Python 3.12 |
| Agent Orchestration | LangGraph |
| LLM | Groq (Llama 3.3 70B) |
| Vector DB | Qdrant |
| Relational DB | PostgreSQL + SQLAlchemy |
| Full-text Search | PostgreSQL FTS (tsvector + GIN) |
| Embeddings | BAAI/bge-small-en-v1.5 (local, no API key) |
| Reranking | cross-encoder/ms-marco-MiniLM-L-6-v2 |
| Task Queue | Celery + Redis |
| Tracing | Langfuse (optional) |
| Evaluation | RAGAS |
| Frontend | Next.js 16 + Tailwind + shadcn/ui |
| Deployment | Docker Compose |

---

## Features

**Retrieval**
- Hybrid retrieval — dense + sparse fused with Reciprocal Rank Fusion (RRF)
- HyDE — query expanded to hypothetical answer before embedding
- Graph RAG — entity extraction + entity-overlap retrieval
- RAPTOR — cluster summaries for broad questions
- Confidence threshold — low score triggers web search fallback

**Ingestion**
- PDF, DOCX, TXT, Markdown, Web URLs
- Text cleaning — removes emails, DOIs, references, copyright noise
- Multi-modal — PDF image extraction + Groq vision descriptions
- Hash deduplication — same file ingested twice → instant skip
- Async ingestion via Celery for large documents

**Agents (LangGraph)**
- Planner — query complexity analysis, sub-query decomposition
- Grader — LLM relevance check
- Contradiction Detector — flags conflicting claims between sources
- Generator — context-grounded answer with streaming SSE
- Citation Verifier — verifies [1][2] references against chunks
- Hallucination Checker — answer grounded in retrieved context?
- Web Search Agent — Tavily/DuckDuckGo fallback, auto-ingests into KB

**Memory**
- Short-term — in-memory session cache
- Long-term — Postgres-backed conversation history per session

---

## Quick Start

**1. Clone and setup**
```bash
git clone https://github.com/your-username/ResearchOS.git
cd ResearchOS
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

**2. Environment variables**

Create `.env` file:
```env
GROQ_API_KEY=your_groq_key
POSTGRES_URL=postgresql+asyncpg://postgres:password@localhost:5432/researchos
QDRANT_URL=http://localhost:6333
REDIS_URL=redis://localhost:6379/0

# Optional
TAVILY_API_KEY=your_tavily_key
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
```

**3. Start infrastructure**
```bash
docker-compose up postgres redis qdrant -d
```

**4. Run migrations**
```bash
alembic upgrade head
```

**5. Start backend**
```bash
uvicorn main:app --reload
```

**6. Start frontend** (new terminal)
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`

---

## One-command Deployment (Docker)

```bash
docker-compose up --build
```

Starts everything: Postgres, Qdrant, Redis, backend (with auto-migration), Celery worker, frontend.

---

## Ingest Papers

```bash
python -m scripts.arxiv_ingest --query "retrieval augmented generation" --max 10 --domain ml
```

Build RAPTOR summaries after ingestion:
```bash
python -m scripts.build_raptor --domain ml
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/research/ingest` | Sync ingest (waits for completion) |
| POST | `/research/ingest/async` | Async ingest via Celery |
| GET | `/research/tasks/{id}` | Check task status |
| POST | `/research/query` | Query knowledge base |
| POST | `/research/query/stream` | Streaming query (SSE) |

Interactive docs: `http://localhost:8000/docs`

---

## Project Structure

```
ResearchOS/
├── backend/
│   ├── agents/          # LangGraph nodes + graph
│   ├── api/             # FastAPI routes + schemas
│   ├── core/            # Config + settings
│   ├── db/              # SQLAlchemy models
│   ├── ingestion/       # Parsers, chunkers, cleaning, embedding
│   │   ├── cleaning/    # Text noise removal
│   │   ├── graph/       # Entity extraction
│   │   ├── multimodal/  # PDF image → Groq vision
│   │   └── raptor/      # Cluster summarization
│   ├── memory/          # Conversation history store
│   ├── retrieval/       # Dense, sparse, hybrid, HyDE, graph
│   └── workers/         # Celery tasks
├── frontend/            # Next.js chat + ingest UI
├── migrations/          # Alembic DB migrations
├── scripts/             # arxiv ingest, RAPTOR builder, KB reset
├── tests/               # Unit + evaluation tests
├── Architecture/        # System design docs + flow diagrams
├── docker-compose.yml
└── Dockerfile
```

---

## Evaluation

```bash
python -m scripts.run_eval
```

RAGAS metrics: Faithfulness, Answer Relevancy, Context Recall, Context Precision.
