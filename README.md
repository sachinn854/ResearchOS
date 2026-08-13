<div align="center">

# ResearchOS

**Ask a question across your own papers. Get an answer where every claim names the passage it came from.**

A retrieval-augmented generation platform written from scratch — chunking, embedding, retrieval,
fusion, the agent graph and the ingestion pipeline are all first-party code. No RAG framework
abstractions.

<br/>

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-1C3C3C?style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Qdrant](https://img.shields.io/badge/Qdrant-DC244C?style=flat-square)
![Celery](https://img.shields.io/badge/Celery-37814A?style=flat-square&logo=celery&logoColor=white)
![Tests](https://img.shields.io/badge/tests-118%20offline-2ea043?style=flat-square)

</div>

---

## What it does

Twenty papers on a topic, one question, one cited answer.

```
You  ─  What are the main approaches to reducing hallucination in RAG?

       Searching your papers · 8 passages · Dense + Sparse + RRF

ResearchOS
       Three approaches appear across the retrieved work:

       1. Retrieval grounding — constrain the model to the context only ⁽¹⁾
       2. Hallucination detection — a checker flags ungrounded claims ⁽²⁾
       3. Contradiction detection — conflicting claims surfaced first ⁽³⁾

       ① Attention Is All You Need      p.12 · 0.842
       ② RAG: A Survey                  p.4  · 0.791
       ③ Self-RAG                       p.9  · 0.774
```

Every `⁽ⁿ⁾` in the answer is a control. Clicking it opens that passage, with its page number and
the retrieval score that put it there — so a claim can be checked without leaving the answer.

---

## How an answer is built

`POST /research/query` runs the full agent graph:

```mermaid
flowchart TD
    Q([Your question]) --> P[Planner<br/>complexity, sub-queries]
    P --> R{{Hybrid retriever}}

    R --> D[Dense · Qdrant<br/>HyDE-expanded query]
    R --> S[Sparse · Postgres FTS<br/>BM25 over tsvector]
    R --> G[Graph entity · Qdrant<br/>entity overlap]

    D --> F[RRF fusion<br/>k = 60]
    S --> F
    G -. off in production .-> F

    F --> GR{Relevant<br/>enough?}
    GR -- no --> W[Web search<br/>Tavily / DuckDuckGo]
    GR -- yes --> C[Contradiction detector]

    W --> GEN[Generator]
    C --> GEN
    GEN --> CV[Citation verifier]
    CV --> HC[Hallucination checker]
    HC --> A([Answer + cited passages])

    style G stroke-dasharray: 5 5
```

`POST /research/query/stream` is a **different, shorter path**, and the difference is not
cosmetic. LangGraph runs a node to completion before moving on; streaming needs tokens out of the
generator while it is still running. So the streaming endpoint calls the retriever directly:

```mermaid
flowchart LR
    Q([Question]) --> R[Retriever<br/>dense + sparse + RRF]
    R --> SRC[/sources + pipeline<br/>sent before the first token/]
    SRC --> GEN[Generator<br/>token by token over SSE]
    GEN --> A([Answer])
```

> **It skips the planner, contradiction detector, citation verifier and hallucination checker.**
> The verification in the first diagram is real only on `/research/query`. Said plainly here
> because a README that describes one path and ships another is the most expensive kind of
> documentation error.

Sources are sent *before* the first token rather than after the last: nothing in that frame
depends on the answer, and holding it back meant the reader spent the whole generation not
knowing which papers were in use.

Node-by-node detail → [`Architecture/FLOW_DIAGRAM.md`](Architecture/FLOW_DIAGRAM.md)

<details>
<summary><b>Ingestion — eight steps, in this order for reasons</b></summary>

```mermaid
flowchart LR
    F[File or URL] --> PA[Parse<br/>PDF · DOCX · TXT · MD · HTML]
    PA --> CL[Clean<br/>emails, DOIs, references, boilerplate]
    CL --> CH[Chunk]
    CH --> EM[Embed<br/>bge-small-en-v1.5, local]
    EM --> PG[(Postgres<br/>commit first)]
    PG --> QD[(Qdrant<br/>batches of 64)]
```

Two ordering rules carry weight:

- **Postgres commits before Qdrant upserts.** The other order left orphan vectors behind whenever
  Postgres failed. This way a Qdrant failure is recoverable — the document is marked `failed` and
  can be re-ingested.
- **Qdrant upserts go in batches of 64.** One request with 300+ points times out against Qdrant
  Cloud, and because Postgres has already committed, a timeout leaves a document that is
  searchable by keyword and invisible to dense retrieval — the worst possible half-state.

Deduplication is on the SHA-256 of the file, not on title or path. URLs hash to nothing and are
never deduplicated.

</details>

---

## What is off in production

Kept explicit because the gap between a documented system and a deployed one is the easiest kind
of lie to tell by accident.

| Component | State | Why |
|---|---|---|
| Graph entity retrieval | **Off** — `ENABLE_ENTITY_EXTRACTION=false` | The configured model returned no usable entities, so it was pure cost. Dense + sparse + RRF are the signals that run — **two retrieval signals, not three.** |
| PDF image descriptions | **Off** — `ENABLE_IMAGE_DESCRIPTION=false` | The vision model 404s on OpenRouter, so every image was a failing HTTP call. |
| RAPTOR cluster summaries | **Not in the query path** | `scripts/build_raptor.py` is an offline script. Nothing in retrieval reads its output yet. |
| Streaming verification | **Not run** | See above. The `has_hallucination` and `grader_passed` fields on a streamed response are hardcoded. |
| Cross-encoder reranking | **Not implemented** | Ranking is RRF only. The `reranked` flag means "RRF ran", nothing more. |

---

## The interface

Not a chat transcript. A question is a heading, its answer is a column of prose at a reading
measure, and the passages behind it sit in a rail alongside — evidence gets the permanent band of
the screen that navigation used to take.

```
┌──────────────────────────────────────────────────────────────────┐
│ ◱ ResearchOS │ Recent 3 │ Add a document      All domains ▾  ☾  S │
├───────────────────────────────────────┬──────────────────────────┤
│                                       │ EVIDENCE                 │
│ What are the main approaches to       │ 8 passages · Dense +     │
│ reducing hallucination in RAG?        │ Sparse + RRF             │
│                                       │                          │
│ Three approaches appear across the    │ ① Attention Is All You…  │
│ retrieved work: retrieval grounding⑴, │   p.12 · 0.842           │
│ a checker that flags ungrounded       │ ② RAG: A Survey          │
│ claims⑵, and contradiction detection⑶.│   p.4  · 0.791           │
│                                       │ ③ Self-RAG               │
│ [ Ask a question about your papers ↑] │   p.9  · 0.774           │
└───────────────────────────────────────┴──────────────────────────┘
```

Below `xl` the rail folds in under the answer, rendering the same component off the same state so
the narrow layout cannot drift from the wide one. Both themes are solved by measuring every ink
against the worst surface it can land on — usually a tinted wash, not the page — and nothing
dimmer than 4.5:1 ships.

---

## Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI · Python 3.12 in the image, 3.13 locally |
| Agent orchestration | LangGraph |
| LLM | OpenRouter — `openai/gpt-oss-120b`, plus a smaller `:free` model for classification |
| Vector store | Qdrant |
| Relational | PostgreSQL + SQLAlchemy (async) |
| Full-text search | PostgreSQL FTS — `tsvector` + GIN |
| Embeddings | `BAAI/bge-small-en-v1.5`, local, no API key |
| Ranking | Reciprocal Rank Fusion, k = 60 |
| Auth | bcrypt + HS256 JWT |
| Queue | Celery + Redis, two queues |
| Tracing | Langfuse (optional) |
| Evaluation | Hand-written RAGAS-style metrics — RAGAS itself is not a dependency |
| Frontend | Next.js 16 · Tailwind 4 · Source Serif 4 / Instrument Sans |
| Deployment | Railway, three services · Docker Compose for local infra |

---

## Quick start

**1 · Clone and install**

```bash
git clone https://github.com/sachinn854/ResearchOS.git
cd ResearchOS
python -m venv venv
venv\Scripts\activate          # Windows;  source venv/bin/activate elsewhere
pip install -r requirements.txt
```

**2 · Environment**

Create a `.env`. These five are **required** — the app refuses to start without them, deliberately,
rather than falling back to a committed default anyone could use to mint valid tokens.

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

Full list in [`.env.example`](.env.example).

**3 · Infrastructure, migrations, backend**

```bash
docker-compose up postgres redis qdrant -d
alembic upgrade head
uvicorn main:app --reload        # from the repo root — main.py imports backend.*
```

**4 · Celery worker** — new terminal

`-Q` is not optional: without it the `background` queue is never consumed and web-fallback ingests
pile up in Redis silently. `-P solo` is required on Windows, whose lack of `fork()` otherwise
surfaces as an unhelpful pickling error.

```bash
celery -A backend.workers.celery_app worker --loglevel=info -P solo -Q ingest,background
```

**5 · Frontend** — new terminal

```bash
cd frontend && npm install && npm run dev
```

Open `http://localhost:3000`.

<details>
<summary><b>All-in-one with Docker Compose</b></summary>

```bash
docker-compose up --build
```

Starts Postgres, Qdrant, Redis, the backend, both Celery workers and the frontend.

> The compose file runs `alembic upgrade head` in the backend's start command. That is fine for a
> single local container and **not** how this deploys: on a platform with replicas every one of
> them races the same migration, and any migration problem becomes an outage of an app that could
> otherwise serve. In production, migrations are a deliberate one-off.

</details>

---

## Fill the knowledge base

```bash
python -m scripts.arxiv_ingest --query "retrieval augmented generation" --max 10 --domain ml
```

RAPTOR cluster summaries can be built, but **no retrieval path reads them yet**, so this does not
currently change any answer:

```bash
python -m scripts.build_raptor --domain ml
```

---

## API

Every `/research/*` route requires a bearer token. Identity comes from the signed token, never
from a body field or query parameter the client fills in.

| | Endpoint | |
|---|---|---|
| `POST` | `/auth/register` | Create an account, returns a JWT |
| `POST` | `/auth/login` | Sign in, returns a JWT |
| `GET` | `/auth/me` | Current user from the token |
| `POST` | `/research/upload` | Upload a file — multipart, 50 MB max |
| `POST` | `/research/ingest` | Sync ingest from a path or URL |
| `POST` | `/research/ingest/async` | Async ingest via Celery |
| `GET` | `/research/tasks/{id}` | Ingest task status |
| `POST` | `/research/query` | Query — full agent graph |
| `POST` | `/research/query/stream` | Streaming query over SSE — skips verification |
| `GET` | `/research/sessions` | The signed-in user's recent sessions |
| `GET` | `/research/sessions/{id}/messages` | One session's history |
| `GET` | `/health` | Liveness |

Interactive docs at `http://localhost:8000/docs`.

---

## Notable decisions

<details>
<summary><b>Web fallback thresholds on the raw cosine score, not the fused one</b></summary>

The decision to go to the web triggers on `best_dense_score < 0.45`, and that number has to come
from the raw Qdrant cosine score captured *before* RRF overwrites it. RRF scores are rank-derived
and land in a narrow 0.013–0.033 band regardless of relevance, so thresholding on them is
meaningless. `HybridRetriever.retrieve` returns `(chunks, best_dense_score)` for exactly this
reason.

</details>

<details>
<summary><b>Two Celery queues, not one, and not Celery's priority argument</b></summary>

| Queue | Who is waiting |
|---|---|
| `ingest` | A user, polling `/research/tasks/{id}` |
| `background` | Nobody — storing web results for future queries |

A web-fallback query enqueues up to five background ingests. On a single queue, a user who then
uploads a PDF waits behind all five while nobody waits on those five. `priority=` does not fix
this on a Redis broker: Redis has no native priority queue, kombu emulates it with per-priority
keys, and it only reorders messages already sitting in the queue. Separate queues with separate
workers actually guarantee it.

</details>

<details>
<summary><b>Reasoning models cap reasoning and output together</b></summary>

`gpt-oss` reasons before it writes, and `max_tokens` bounds both. The domain guard, the grader and
the hallucination checker were each given 5 or 10 tokens — so every one returned
`finish_reason="length"` with `content=None`, and none of the three had ever run. They get 300 now.

</details>

<details>
<summary><b>Nothing on the startup path may prevent serving</b></summary>

`init_collection()` is a blocking call to Qdrant Cloud on a client with a 120s timeout, and an
exception in `lifespan` aborts startup entirely — so it is wrapped and logged as a warning. For
the same reason no module builds an embedding service at import time; `get_embedder()` is a lazy,
lock-guarded singleton. Three modules each constructing their own took boot from 246 MB to 735 MB
and 4.8s to 7.3s, before uvicorn had bound the port.

</details>

---

## Layout

```
backend/
├── agents/          LangGraph nodes and the graph wiring
├── api/             routes, schemas, dependencies, middleware
├── core/            config, security (JWT + bcrypt), LLM client
├── db/              SQLAlchemy models, Postgres and Qdrant clients
├── ingestion/       parsers · cleaning · chunking · embedding · pipeline
├── evaluation/      RAGAS-style evaluator
├── memory/          conversation history store
├── retrieval/       dense · sparse · hybrid · HyDE · graph
└── workers/         Celery app and tasks
frontend/            Next.js — the answer screen and ingest
migrations/          Alembic
scripts/             arxiv ingest · RAPTOR builder · KB reset · eval
tests/               118 offline unit tests
Architecture/        design notes and flow diagrams
```

Two files carry most of the complexity and are worth reading first:
[`backend/api/routes/research.py`](backend/api/routes/research.py) — the whole query path,
streaming and not — and `backend/ingestion/pipeline.py`, whose eight steps are numbered in the log
lines so a truncated production log still says where it stopped.

---

## Tests

```bash
pytest -q
```

118 tests, all offline. Nothing touches the network, Postgres, Qdrant or Redis; LLM and embedding
calls are stubbed. Keep it that way, or the suite stops being something you run before every
commit.

`tests/unit/test_auth_enforcement.py` is the one to keep green above all others: it asserts that
protected routes actually depend on `get_current_user`. It exists because auth was added late, and
a route written without that dependency looks completely normal.

---

## Evaluation

```bash
python -m scripts.run_eval
```

Four metrics, implemented directly rather than through the RAGAS package. **faithfulness** and
**answer_relevancy** grade generation; **context_recall** and **context_precision** grade
retrieval. Keeping them apart is the point — high faithfulness with low context_recall means the
generator is fine and retrieval is the bottleneck.

No scores are published here. Run it against your own knowledge base.
