import logging
import logging.config
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes.research import router as research_router
from backend.db.qdrant_client import init_collection

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            "datefmt": "%H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "loggers": {
        "researchos": {"level": "INFO", "handlers": ["console"], "propagate": False},
    },
}

logging.config.dictConfig(LOGGING_CONFIG)
log = logging.getLogger("researchos.app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("ResearchOS starting up...")
    init_collection()
    log.info("Ready.")
    yield
    log.info("ResearchOS shutting down.")


app = FastAPI(title="ResearchOS", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(research_router)


@app.get("/health")
def health():
    return {"status": "ok"}
