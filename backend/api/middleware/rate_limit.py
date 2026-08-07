import logging

import redis

from backend.core.config import settings

log = logging.getLogger("researchos.rate_limit")

_client = redis.from_url(settings.redis_url, decode_responses=True)

WINDOW_SECONDS = 20 * 60  # 20 minutes
MAX_REQUESTS = 2

# BUG-007 (partial): atomic INCR + conditional EXPIRE via Lua script.
# Previous approach had a race: INCR + TTL were pipelined but EXPIRE was a
# separate call. If the key expired between the pipeline and the expire call,
# the new key had no TTL and the counter grew forever.
_RATE_LIMIT_SCRIPT = _client.register_script("""
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
""")


def check_rate_limit(ip: str) -> tuple[bool, int]:
    """Check if IP is within rate limit.

    Returns (is_allowed, retry_after_seconds).
    Uses a fixed window counter in Redis with atomic Lua INCR+EXPIRE.
    """
    key = f"rl:{ip}"
    try:
        count, ttl = _RATE_LIMIT_SCRIPT(keys=[key], args=[WINDOW_SECONDS])
        count = int(count)
        ttl = int(ttl)

        if count > MAX_REQUESTS:
            log.warning("[rate_limit] IP=%s blocked | count=%d | retry_after=%ds", ip, count, ttl)
            return False, max(ttl, 0)

        log.debug("[rate_limit] IP=%s | count=%d/%d", ip, count, MAX_REQUESTS)
        return True, 0

    except Exception as exc:
        # Redis down → allow request rather than block everyone
        log.warning("[rate_limit] Redis unavailable, skipping check: %s", exc)
        return True, 0
