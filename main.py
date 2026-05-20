from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.api.routes.research import router as research_router
from backend.db.qdrant_client import init_collection


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_collection()
    yield


app = FastAPI(title="ResearchOS", version="0.1.0", lifespan=lifespan)

app.include_router(research_router)


@app.get("/health")
def health():
    return {"status": "ok"}
