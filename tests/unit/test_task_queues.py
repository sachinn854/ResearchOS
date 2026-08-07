"""Tests for Celery queue routing (PENDING #9).

The failure these guard against is silent: a task routed to a queue no worker
consumes is accepted by `.delay()`, returns a task id, and then never runs. The
API happily reports "queued" forever.
"""
from backend.workers.celery_app import QUEUE_BACKGROUND, QUEUE_INGEST, celery_app
from backend.workers import tasks


def test_user_ingest_and_background_ingest_are_on_different_queues():
    """The point of the split: five web-result ingests must not be able to sit in
    front of an upload the user is polling for."""
    routes = celery_app.conf.task_routes

    assert routes["ingest_document"]["queue"] == QUEUE_INGEST
    assert routes["ingest_text"]["queue"] == QUEUE_BACKGROUND
    assert QUEUE_INGEST != QUEUE_BACKGROUND


def test_every_declared_queue_is_actually_defined():
    """A route pointing at a queue that is not in task_queues means messages go
    somewhere no worker is told to look."""
    defined = {queue.name for queue in celery_app.conf.task_queues}
    routed = {route["queue"] for route in celery_app.conf.task_routes.values()}

    assert routed <= defined, f"routed to undefined queues: {routed - defined}"


def test_every_task_is_routed():
    """Catches a new task being added without a queue, which would land on the
    default queue by accident rather than by decision."""
    our_tasks = {
        name for name in celery_app.tasks
        if not name.startswith("celery.")
    }
    routed = set(celery_app.conf.task_routes)

    assert our_tasks == routed, f"unrouted tasks: {our_tasks - routed}"


def test_task_decorators_agree_with_the_routing_table():
    """Two places declare the queue — the decorator and task_routes. If they
    disagree the behaviour depends on which one Celery consults."""
    assert tasks.ingest_document_task.queue == QUEUE_INGEST
    assert tasks.ingest_text_task.queue == QUEUE_BACKGROUND


def test_worker_takes_one_task_at_a_time():
    """Celery's default reserves 4 tasks per worker. With long ingest jobs that
    recreates the head-of-line blocking the queues exist to remove."""
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_tasks_are_acknowledged_after_completion():
    """acks_late means a worker killed mid-ingest returns the task to the queue
    instead of losing it and leaving the document stuck in 'processing'."""
    assert celery_app.conf.task_acks_late is True


def test_default_queue_is_the_user_facing_one():
    """If a task ever escapes routing, the safer accident is that a user's job
    runs rather than being stranded."""
    assert celery_app.conf.task_default_queue == QUEUE_INGEST
