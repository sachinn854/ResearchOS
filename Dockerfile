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
# sh -c is needed for ${PORT} expansion — the exec form does not run a shell.
# The && is deliberate: if migrations fail, starting the API would only serve
# errors from a half-created schema, so failing loudly is more useful.
#
# The Celery worker uses this same image but must override the start command,
# since it should not serve HTTP or run migrations concurrently with the API:
#   celery -A backend.workers.celery_app worker -P solo -Q ingest,background
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
