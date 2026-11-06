"""
Keep Qdrant Cloud from suspending due to inactivity.

Free Qdrant clusters can be suspended after prolonged idle. This sends
a cheap read-only request. Run once a day via GitHub Actions
(see .github/workflows/keep-qdrant-warm.yml) — not on the 5-min cadence.

Env vars (required — set as GitHub Actions secrets, never in code):
    QDRANT_URL      e.g. https://0d07dd2a-...sa-east-1-0.aws.cloud.qdrant.io
    QDRANT_API_KEY  your Qdrant API key
"""

import os
import sys
import time

import requests

URL = os.getenv("QDRANT_URL", "").rstrip("/")
API_KEY = os.getenv("QDRANT_API_KEY", "")
TIMEOUT = 20


def main() -> int:
    if not URL or not API_KEY:
        print("QDRANT_URL / QDRANT_API_KEY not set — skipping")
        return 1

    try:
        resp = requests.get(f"{URL}/collections", headers={"api-key": API_KEY}, timeout=TIMEOUT)
        print(f"[{time.strftime('%H:%M:%S')}] qdrant /collections: HTTP {resp.status_code}")
        if resp.status_code != 200:
            print(f"  body: {resp.text[:500]}")
            return 1
        names = [c.get("name") for c in resp.json().get("result", {}).get("collections", [])]
        print(f"  collections: {names}")
        # Also touch the actual collection
        col = os.getenv("QDRANT_COLLECTION", "researchos_chunks")
        r2 = requests.get(f"{URL}/collections/{col}", headers={"api-key": API_KEY}, timeout=TIMEOUT)
        print(f"[{time.strftime('%H:%M:%S')}] qdrant /collections/{col}: HTTP {r2.status_code}")
        return 0
    except Exception as exc:
        print(f"qdrant ping FAILED: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
