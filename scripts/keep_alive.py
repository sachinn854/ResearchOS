"""
Keep-alive pinger for Render free tier.

Render free web services spin down after ~15 min of inactivity and need
30-50s to cold-start. This script hits the deployed frontend + backend
every 5 minutes so they stay warm.

Usage:
  python scripts/keep_alive.py                          # every 5 min forever
  python scripts/keep_alive.py --interval 300           # custom interval (seconds)
  python scripts/keep_alive.py --once                   # single ping (for cron)
  FRONTEND_URL=https://... BACKEND_URL=https://... python scripts/keep_alive.py

Deploy options:
  1) Run locally / on any always-on machine:  python scripts/keep_alive.py &
  2) GitHub Actions (free) — add .github/workflows/keep-alive.yml with schedule
  3) Render Cron Job — create a cron service:  */5 * * * *  ->  python scripts/keep_alive.py --once
  4) UptimeRobot / cron-job.org — just add the two URLs below as HTTP monitors

No extra dependencies — uses stdlib + requests (already in requirements.txt).
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("requests not installed — run: pip install requests", file=sys.stderr)
    sys.exit(1)

# Reconfigure stdout for Windows cp1252 safety (same as main.py)
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("keep_alive")

# Defaults — override via env vars so you don't hardcode secrets
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://researchos-frontend-12i4.onrender.com")
BACKEND_URL = os.getenv("BACKEND_URL", "https://researchos-backend-5p2m.onrender.com")
BACKEND_HEALTH = BACKEND_URL.rstrip("/") + "/health"
TIMEOUT = int(os.getenv("PING_TIMEOUT", "15"))


def ping(url: str, timeout: int = TIMEOUT) -> bool:
    """GET url, return True on 2xx/3xx, False otherwise. Never raises."""
    try:
        # Use a browser-like UA — some CDNs block bare python-requests
        resp = requests.get(
            url,
            timeout=timeout,
            headers={"User-Agent": "ResearchOS-keepalive/1.0"},
        )
        ok = 200 <= resp.status_code < 400
        level = logging.INFO if ok else logging.WARNING
        log.log(level, "%s -> %s (%s) %s", url, resp.status_code, resp.reason, "OK" if ok else "FAIL")
        return ok
    except Exception as exc:
        log.warning("%s -> error: %s: %s", url, type(exc).__name__, exc)
        return False


def tick() -> None:
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    log.info("tick @ %s", now)
    urls = [FRONTEND_URL, BACKEND_HEALTH]
    results = [ping(u) for u in urls]
    if all(results):
        log.info("all %d targets alive", len(urls))
    elif any(results):
        log.warning("partial failure — %d/%d alive", sum(results), len(urls))
    else:
        log.error("all targets failed — check Render dashboard")


def main() -> None:
    global FRONTEND_URL, BACKEND_HEALTH
    parser = argparse.ArgumentParser(description="Ping ResearchOS to prevent Render sleep")
    parser.add_argument("--interval", type=int, default=300, help="seconds between pings (default 300 = 5 min)")
    parser.add_argument("--once", action="store_true", help="ping once and exit (for cron jobs)")
    parser.add_argument("--frontend", default=FRONTEND_URL, help="frontend URL to ping")
    parser.add_argument("--backend", default=BACKEND_HEALTH, help="backend health URL to ping")
    args = parser.parse_args()

    # Allow CLI to override env defaults for this run
    FRONTEND_URL = args.frontend
    BACKEND_HEALTH = args.backend

    log.info("keep-alive started | frontend=%s | backend=%s | interval=%ss | once=%s",
             FRONTEND_URL, BACKEND_HEALTH, args.interval, args.once)

    if args.once:
        tick()
        return

    # Forever loop — sleep is interruptible via Ctrl+C / SIGTERM
    try:
        while True:
            tick()
            log.info("next tick in %ds — Ctrl+C to stop", args.interval)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        log.info("stopped by user")


if __name__ == "__main__":
    main()
