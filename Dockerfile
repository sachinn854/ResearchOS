FROM python:3.12-slim

WORKDIR /app

# gcc + libpq-dev needed for any native extensions at install time
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Two things this has to get right, both of which bit us on Railway:
#
# 1. $PORT. Railway (and Render, Fly, Heroku) assign the port at runtime and
#    route only to that one. Hard-coding 8000 meant the container came up fine
#    and the platform proxy got nothing — "Application failed to respond", 502,
#    with healthy-looking container logs. Defaults to 8000 so local docker runs
#    are unchanged.
#
# 2. Migrations. docker-compose.yml ran "alembic upgrade head" as a command
#    override, so it never applied anywhere else. On a fresh managed database
#    that leaves every table missing and every request failing.
#
# Migrations must not be able to prevent the API from starting. Chaining them
# with && did exactly that: alembic connected, printed its two startup lines and
# then hung — most likely on a lock or a pooler connection limit left behind by
# earlier crashed deploys — so uvicorn was never reached. The platform edge had
# nothing to route to and every request came back as a 502, which in a browser
# surfaces as a CORS error because an edge error page carries no
# Access-Control-Allow-Origin header. Hours of debugging pointed at CORS and the
# real cause was a blocked startup.
#
# So: give migrations a bounded attempt, log the outcome, and start the API
# either way. A reachable app that reports its own errors beats an unreachable
# one that reports nothing. If migrations really did not apply, the failure shows
# up as a clear database error per request instead of a silent 502.
#
# exec keeps uvicorn as PID 1 so it receives SIGTERM on shutdown.
# sh -c is needed for ${PORT} expansion — the exec form does not run a shell.
#
# The Celery worker uses this same image but must override the start command,
# since it should not serve HTTP or run migrations concurrently with the API:
#   celery -A backend.workers.celery_app worker -P solo -Q ingest,background
CMD ["sh", "-c", "timeout 90 alembic upgrade head && echo '[startup] migrations OK' || echo '[startup] WARNING: migrations skipped (timeout or error) — starting API anyway'; exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
