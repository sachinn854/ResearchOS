# ResearchOS

A production-grade, learning-focused RAG (Retrieval-Augmented Generation) platform built from scratch. Designed to deeply understand every layer of modern RAG systems — from dense retrieval to agentic pipelines.

No RAG framework abstractions: chunking, embedding, retrieval, fusion, the agent graph, and the ingestion pipeline are all first-party code.

---

## What It Does

ResearchOS lets you ingest research papers and ask questions about them. Instead of reading 20 papers manually, you ask a question and the system synthesizes answers from your knowledge base — with a citation on every claim.

```
You: "What are the main approaches to reduce hallucinations in RAG?"

ResearchOS: [reads 5 relevant chunks from ingested papers]
  "Three main approaches exist:
   1. Retrieval grounding — constrain LLM to context only [1]
   2. Hallucination detection — checker agent flags ungrounded claims [2]
   3. Contradiction detection — conflicting claims surfaced before answering [3]"
```

---

## Architecture

`POST /research/query` runs the full LangGraph agent graph:

```
[User Query]
     ↓
[Planner Agent]          ← decides approach, generates sub-queries
     ↓
[Hybrid Retriever]
  ├── HyDE Dense (Qdrant)    ← hypothetical document embedding
  ├── Sparse BM25 (Postgres) ← keyword full-text search
  └── Graph Entity (Qdrant)  ← entity-overlap matching (OFF in production, see below)
     ↓
[RRF Fusion]             ← Reciprocal Rank Fusion, k=60
     ↓
[Grader Agent]           ← relevant? → continue / no → web search
     ↓
[Contradiction Detector] ← flags conflicting claims between chunks
     ↓
[Generator]              ← OpenRouter LLM
     ↓
[Citation Verifier]      ← checks [1][2] citations against source chunks
     ↓
[Hallucination Checker]  ← answer grounded in context?
```

`POST /research/query/stream` is a **different, shorter path.** It cannot use the graph —
LangGraph runs a node to completion before moving on, and streaming needs tokens out of the
generator while it is still running. So it calls the retriever directly, then streams the
generator over SSE. **It skips the planner, contradiction detector, citation verifier and
hallucination checker.** The verification above is real only on `/research/query`.

Full flow diagrams → [`Architecture/FLOW_DIAGRAM.md`](Architecture/FLOW_DIAGRAM.md)

---

## What is off in production

Kept explicit because the gap between a documented system and a deployed one is the easiest
kind of lie to tell by accident.

| Component | State | Why |
|---|---|---|
| Graph entity retrieval | **Off** (`ENABLE_ENTITY_EXTRACTION=false`) | The configured model returned no usable entities, so it was pure cost. Dense + sparse + RRF are the signals that actually run — **two retrieval signals, not three.** |
| PDF image descriptions | **Off** (`ENABLE_IMAGE_DESCRIPTION=false`) | The vision model 404s on OpenRouter, so every image was a failing HTTP call. |
| RAPTOR cluster summaries | **Not in the query path** | `scripts/build_raptor.py` is an offline script. Nothing in retrieval reads its output yet. |
| Streaming verification | **Not run** | See the note above. The `has_hallucination` / `grader_passed` fields on a streamed response are hardcoded. |
| Cross-encoder reranking | **Not implemented** | Ranking is RRF only. The `reranked` flag on a response means "RRF ran", nothing more. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI + Python 3.13 |
| Agent Orchestration | LangGraph |
| LLM | OpenRouter (`openai/gpt-oss-120b`; a smaller `:free` model for classification) |
| Vector DB | Qdrant |
| Relational DB | PostgreSQL + SQLAlchemy (async) |
| Full-text Search | PostgreSQL FTS (tsvector + GIN) |
| Embeddings | BAAI/bge-small-en-v1.5 (local, no API key) |
| Ranking | Reciprocal Rank Fusion (k=60) |
| Auth | bcrypt password hashing + HS256 JWT |
| Task Queue | Celery + Redis (two queues) |
| Tracing | Langfuse (optional) |
| Evaluation | Hand-written RAGAS-style metrics (RAGAS itself is not a dependency) |
| Frontend | Next.js 16 + Tailwind 4 |
| Deployment | Railway (3 services); Docker Compose for local infra |

---

## Features

**Retrieval**
- Hybrid retrieval — dense + sparse fused with Reciprocal Rank Fusion (RRF)
- HyDE — query expanded to a hypothetical answer before embedding
- Graph RAG — entity extraction + entity-overlap retrieval (built; disabled in production)
- Web fallback — the decision uses the raw Qdrant cosine score captured *before* RRF, because
  RRF scores are rank-derived and land in a narrow band regardless of relevance

**Ingestion**
- PDF, DOCX, TXT, Markdown, Web URLs — 50 MB per file
- Text cleaning — removes emails, DOIs, references, copyright noise
- Multi-modal — PDF image extraction + vision descriptions (built; disabled in production)
- Hash deduplication — SHA-256 of file contents; same file twice → instant skip
- Async ingestion via Celery for URLs; Postgres commits before Qdrant so a vector-store
  failure is recoverable instead of leaving orphan vectors

**Agents (LangGraph)**
- Planner — query complexity analysis, sub-query decomposition
- Grader — LLM relevance check
- Contradiction Detector — flags conflicting claims between sources
- Generator — context-grounded answer, streaming over SSE
- Citation Verifier — verifies [1][2] references against chunks
- Hallucination Checker — answer grounded in retrieved context?
- Web Search — Tavily when a key is set, DuckDuckGo otherwise; results auto-ingest into the KB

**Auth**
- Email/password accounts; bcrypt hashing, HS256 JWT sessions
- One dependency (`get_current_user`) establishes identity on every protected route
- Conversation history and documents are scoped to the token's user, not to a client-supplied id

**Memory**
- Short-term — in-memory cache, last 10 messages, keyed by (user, session)
- Long-term — Postgres-backed conversation history per session

**Limits**
- 2 queries per 20 minutes, per IP (in-process; resets on deploy, not shared across replicas)
- Optional domain guard — with a domain selected, off-topic questions are refused

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

Create a `.env` file. These five are **required** — the app refuses to start without them,
deliberately, rather than falling back to a committed default anyone could use:

```env
OPENROUTER_API_KEY=your_openrouter_key   # https://openrouter.ai/keys
POSTGRES_URL=postgresql+asyncpg://postgres:password@localhost:5432/researchos
QDRANT_URL=http://localhost:6333
REDIS_URL=redis://localhost:6379/0
JWT_SECRET_KEY=a_long_random_string

# Optional
TAVILY_API_KEY=                 # web search; falls back to DuckDuckGo when empty
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
ENABLE_ENTITY_EXTRACTION=false  # graph retrieval signal
ENABLE_IMAGE_DESCRIPTION=false  # PDF image descriptions
```

See [`.env.example`](.env.example) for the full list.

**3. Start infrastructure**
```bash
docker-compose up postgres redis qdrant -d
```

**4. Run migrations**
```bash
alembic upgrade head
```

**5. Start backend** (from the repo root — `main.py` imports `backend.*`)
```bash
uvicorn main:app --reload
```

**6. Start the Celery worker** (new terminal)

`-Q` is not optional: without it the `background` queue is never consumed and web-fallback
ingests pile up in Redis silently. `-P solo` is required on Windows.
```bash
celery -A backend.workers.celery_app worker --loglevel=info -P solo -Q ingest,background
```

**7. Start frontend** (new terminal)
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`

---

## Local Docker

```bash
docker-compose up --build
```

Starts Postgres, Qdrant, Redis, backend, both Celery workers, and the frontend.

> The compose file runs `alembic upgrade head` in the backend's start command. That is
> acceptable for a single local container and **not** how it is deployed: on a platform with
> replicas every one of them races the same migration, and any migration problem becomes an
> outage of an app that could otherwise serve. In production migrations are run as a
> deliberate one-off.

---

## Ingest Papers

```bash
python -m scripts.arxiv_ingest --query "retrieval augmented generation" --max 10 --domain ml
```

Optionally build RAPTOR cluster summaries. This writes summaries but **no retrieval path
reads them yet**, so it does not currently affect answers:
```bash
python -m scripts.build_raptor --domain ml
```

---

## API Endpoints

All `/research/*` routes require a bearer token.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create an account, returns a JWT |
| POST | `/auth/login` | Sign in, returns a JWT |
| GET | `/auth/me` | Current user from the token |
| POST | `/research/upload` | Upload a file (multipart, 50 MB max) |
| POST | `/research/ingest` | Sync ingest from a path or URL |
| POST | `/research/ingest/async` | Async ingest via Celery |
| GET | `/research/tasks/{id}` | Check ingest task status |
| POST | `/research/query` | Query — full agent graph |
| POST | `/research/query/stream` | Streaming query (SSE) — skips verification |
| GET | `/research/sessions` | The signed-in user's recent sessions |
| GET | `/research/sessions/{id}/messages` | One session's history |
| GET | `/health` | Liveness |

Interactive docs: `http://localhost:8000/docs`

---

## Project Structure

```
ResearchOS/
├── backend/
│   ├── agents/          # LangGraph nodes + graph
│   ├── api/             # FastAPI routes, schemas, deps, middleware
│   ├── core/            # Config, security (JWT + bcrypt), LLM client
│   ├── db/              # SQLAlchemy models, Postgres + Qdrant clients
│   ├── ingestion/       # Parsers, chunkers, cleaning, embedding
│   │   ├── cleaning/    # Text noise removal
│   │   ├── graph/       # Entity extraction
│   │   ├── multimodal/  # PDF image → vision description
│   │   └── raptor/      # Cluster summarization (offline)
│   ├── evaluation/      # RAGAS-style evaluator
│   ├── memory/          # Conversation history store
│   ├── retrieval/       # Dense, sparse, hybrid, HyDE, graph
│   └── workers/         # Celery app + tasks
├── frontend/            # Next.js chat + ingest UI
├── migrations/          # Alembic DB migrations
├── scripts/             # arxiv ingest, RAPTOR builder, KB reset, eval
├── tests/               # 118 offline unit tests
├── Architecture/        # System design docs + flow diagrams
├── docker-compose.yml
└── Dockerfile
```

---

## Tests

```bash
pytest -q
```

118 tests, all offline — nothing touches the network, Postgres, Qdrant or Redis; LLM and
embedding calls are stubbed. `tests/unit/test_auth_enforcement.py` asserts that protected
routes actually depend on `get_current_user`; it exists because auth was added late, and a
route added without that dependency looks completely normal.

---

## Evaluation

```bash
python -m scripts.run_eval
```

Four metrics, implemented directly rather than via the RAGAS package: **faithfulness** and
**answer_relevancy** grade generation; **context_recall** and **context_precision** grade
retrieval. Keeping them apart is the point — high faithfulness with low context_recall means
the generator is fine and retrieval is the bottleneck.

No evaluation scores are published here. Run it against your own knowledge base.
