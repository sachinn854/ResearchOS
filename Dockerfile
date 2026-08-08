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

# Start uvicorn and nothing else. Migrations are deliberately NOT here.
#
# $PORT: Railway (and Render, Fly, Heroku) assign the port at runtime and route
# only to that one. Hard-coding 8000 meant the container came up fine and the
# platform proxy got nothing — "Application failed to respond", 502, with
# healthy-looking logs. Defaults to 8000 so local docker runs are unchanged.
#
# Why migrations are gone from this line, in three steps:
#
# 1. They started as a docker-compose command override, so they only ever ran
#    under compose — never on a deployed platform. A fresh managed database was
#    left with no tables at all.
#
# 2. Moving them here as "alembic upgrade head && uvicorn" made it worse.
#    Alembic connected, printed its two startup lines, and hung — a lock or a
#    pooler connection limit left behind by an earlier crashed deploy. With &&,
#    uvicorn was never reached. The edge had nothing to route to, so every
#    request was a 502; in a browser that surfaces as a CORS error, because an
#    edge error page carries no Access-Control-Allow-Origin header. That sent
#    the debugging in entirely the wrong direction.
#
# 3. "timeout 90 alembic upgrade head; uvicorn" looked like the fix and was not.
#    timeout sends SIGTERM, and the driver was blocked inside a C-level socket
#    call — CPython can only run a signal handler between bytecodes, so the
#    signal sat unhandled and the process hung anyway. The deploy log ended on
#    alembic's second line and the container went to EXITED without ever
#    printing the warning branch or reaching uvicorn.
#
# The real lesson is that schema changes do not belong in the start command of
# a web process at all. Every replica would race the same migration, and any
# migration problem becomes an outage of an app that could otherwise serve.
# Run them as a deliberate one-off step instead, before or after deploying:
#
#   railway run --service researchos-backend alembic upgrade head
#
# If the schema really is behind, requests fail with a clear Postgres error
# naming the missing table. That is diagnosable. An unreachable app is not.
#
# exec keeps uvicorn as PID 1 so it receives SIGTERM on shutdown.
# sh -c is needed for ${PORT} expansion — the exec form does not run a shell.
#
# The Celery worker uses this same image but must override the start command,
# since it should not serve HTTP:
#   celery -A backend.workers.celery_app worker -P solo -Q ingest,background
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
