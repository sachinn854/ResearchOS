from celery import Celery
from kombu import Queue

from backend.core.config import settings

# Queue names. Kept as constants so the task decorators, the config below, and
# the worker commands in docker-compose.yml / render.yaml cannot drift apart —
# a typo in a queue name means tasks are queued and never consumed, with no error.
QUEUE_INGEST = "ingest"
QUEUE_BACKGROUND = "background"

celery_app = Celery(
    "researchos",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["backend.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    result_expires=3600,

    # ------------------------------------------------------------------
    # Priority via separate queues (PENDING #9)
    #
    # The problem this solves: when a query falls back to web search,
    # `_trigger_background_ingest` queues up to 5 `ingest_text` tasks. With one
    # shared queue, a user who then uploads a PDF waits behind all five — and
    # nobody is waiting on those five, while the user is staring at a spinner.
    #
    # Two queues, each with its own worker:
    #   ingest      — user asked for this and is polling /research/tasks/{id}
    #   background  — KB enrichment from web results, fire-and-forget
    #
    # Note on Celery's `priority=` argument: it is unreliable on a Redis broker
    # (Redis has no native priority queue, so kombu emulates it with separate
    # keys per priority level and it only orders messages already sitting in the
    # queue). Separate queues with separate workers actually guarantees that a
    # slow background job cannot occupy the worker a user is waiting on.
    # ------------------------------------------------------------------
    task_default_queue=QUEUE_INGEST,
    task_queues=(
        Queue(QUEUE_INGEST),
        Queue(QUEUE_BACKGROUND),
    ),
    task_routes={
        "ingest_document": {"queue": QUEUE_INGEST},
        "ingest_text": {"queue": QUEUE_BACKGROUND},
    },

    # Take one task at a time. The default is 4, which means a worker reserves
    # four tasks up front — so three of them sit idle inside a busy worker while
    # another worker has nothing to do. With long ingest jobs that reintroduces
    # exactly the head-of-line blocking the queues are here to remove.
    worker_prefetch_multiplier=1,

    # Acknowledge after the task finishes, not when it is received. If a worker
    # is killed mid-ingest (OOM, deploy, Ctrl-C) the task goes back to the queue
    # instead of vanishing and leaving the document stuck in "processing".
    # Safe here because both tasks are effectively idempotent — ingestion
    # deduplicates on file_hash.
    task_acks_late=True,
)
