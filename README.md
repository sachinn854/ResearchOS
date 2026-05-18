# ResearchOS

Production-grade AI research platform — built to learn RAG, retrieval engineering, and agentic AI from the ground up.

## Stack

- **Backend** — FastAPI, LangGraph, Python 3.11+
- **Vector DB** — Qdrant
- **Cache / Queue** — Redis, Celery
- **Database** — PostgreSQL
- **Frontend** — Next.js, Tailwind

## Setup

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in your API keys.

```bash
docker compose up -d   # starts Postgres, Qdrant, Redis
uvicorn backend.main:app --reload
```

## Architecture

See [`Architecture/MASTER_ARCHITECTURE.md`](Architecture/MASTER_ARCHITECTURE.md)
