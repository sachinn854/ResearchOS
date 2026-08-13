import logging
import logging.config
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes.auth import router as auth_router
from backend.api.routes.research import router as research_router
from backend.core.config import settings
from backend.db.qdrant_client import init_collection

# A Windows console defaults to cp1252, and any log line containing a character
# outside it — a non-breaking hyphen or an em dash out of a model's answer is
# enough — makes the handler raise UnicodeEncodeError and drop that line. On
# Linux this is already UTF-8 and the call changes nothing, so it is not guarded
# by a platform check. errors="replace" so an odd character degrades to "?"
# rather than costing us the line we were trying to read.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

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

    # Nothing on the startup path is allowed to stop the API from serving. This
    # is the same lesson as the alembic hang in the Dockerfile: init_collection()
    # is a blocking network call to Qdrant Cloud on a client with a 120s timeout,
    # so an unreachable or slow Qdrant could hold startup for two minutes, and a
    # raise would abort startup completely. Either way uvicorn never binds, the
    # platform proxy has nothing to route to, and every request is a 502 that
    # never appears in this log — which reads like the app was never deployed.
    #
    # If the collection really is missing, retrieval fails per request with a
    # clear Qdrant error. That is diagnosable; an unreachable app is not.
    try:
        init_collection()
    except Exception as exc:
        log.warning("Qdrant init failed, starting anyway: %s: %s", type(exc).__name__, exc)

    log.info("Ready.")
    yield
    log.info("ResearchOS shutting down.")


app = FastAPI(title="ResearchOS", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Driven by CORS_ORIGINS so a deployed frontend can be allowed without a code
    # change. Note this must list exact origins — "*" is not usable here because
    # the frontend sends an Authorization header, and browsers reject a wildcard
    # origin on credentialed requests.
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)
log.info("CORS allowed origins: %s", settings.cors_origin_list)

app.include_router(auth_router)
app.include_router(research_router)


@app.get("/health")
def health():
    return {"status": "ok"}
