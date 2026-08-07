import logging
import uuid
from collections import defaultdict, deque

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models.conversation import ConversationHistory

log = logging.getLogger("researchos.memory")

# Short-term in-memory cache: (user_id, session_id) → last 10 messages.
#
# The key includes user_id deliberately. Keying on session_id alone would let one
# user's cached messages be served for a session id belonging to someone else,
# which quietly bypasses the ownership filter the SQL below applies.
_cache: dict[tuple[str, str], deque] = defaultdict(lambda: deque(maxlen=10))

MAX_HISTORY = 5  # Q&A pairs passed to the LLM


def _cache_key(session_id: str, user_id: uuid.UUID | str) -> tuple[str, str]:
    return (str(user_id), session_id)


async def load_history(
    session_id: str,
    db: AsyncSession,
    user_id: uuid.UUID | str,
) -> list[dict]:
    """Load the last MAX_HISTORY exchanges for one of this user's sessions.

    The user_id filter is what stops a caller from replaying someone else's
    conversation into their own prompt by guessing a session id.
    """
    result = await db.execute(
        text("""
            SELECT role, content FROM conversation_history
            WHERE session_id = :session_id AND user_id = :user_id
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {"session_id": session_id, "user_id": user_id, "limit": MAX_HISTORY * 2},
    )
    rows = result.fetchall()
    messages = [{"role": r.role, "content": r.content} for r in reversed(rows)]
    log.info("[memory] loaded %d messages for session=%s", len(messages), session_id)

    # Warm in-memory cache
    key = _cache_key(session_id, user_id)
    for m in messages:
        _cache[key].append(m)

    return messages


async def save_exchange(
    session_id: str,
    query: str,
    answer: str,
    db: AsyncSession,
    user_id: uuid.UUID | str,
) -> None:
    """Persist a Q&A pair to Postgres and update the in-memory cache."""
    db.add(ConversationHistory(session_id=session_id, user_id=user_id, role="user", content=query))
    db.add(ConversationHistory(session_id=session_id, user_id=user_id, role="assistant", content=answer[:2000]))
    await db.commit()

    key = _cache_key(session_id, user_id)
    _cache[key].append({"role": "user", "content": query})
    _cache[key].append({"role": "assistant", "content": answer[:2000]})
    log.info("[memory] saved exchange for session=%s", session_id)


def get_cached_history(session_id: str, user_id: uuid.UUID | str) -> list[dict]:
    """Fast in-memory history lookup (no DB hit)."""
    return list(_cache[_cache_key(session_id, user_id)])
