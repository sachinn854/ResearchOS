from celery import Celery

from backend.core.config import settings

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
)
