import logging
from collections import defaultdict, deque

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models.conversation import ConversationHistory

log = logging.getLogger("researchos.memory")

# Short-term in-memory cache: session_id → last 10 messages
_cache: dict[str, deque] = defaultdict(lambda: deque(maxlen=10))

MAX_HISTORY = 5  # Q&A pairs passed to the LLM


async def load_history(session_id: str, db: AsyncSession) -> list[dict]:
    """Load the last MAX_HISTORY exchanges from Postgres for a session."""
    result = await db.execute(
        text("""
            SELECT role, content FROM conversation_history
            WHERE session_id = :session_id
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {"session_id": session_id, "limit": MAX_HISTORY * 2},
    )
    rows = result.fetchall()
    messages = [{"role": r.role, "content": r.content} for r in reversed(rows)]
    log.info("[memory] loaded %d messages for session=%s", len(messages), session_id)

    # Warm in-memory cache
    for m in messages:
        _cache[session_id].append(m)

    return messages


async def save_exchange(session_id: str, query: str, answer: str, db: AsyncSession) -> None:
    """Persist a Q&A pair to Postgres and update the in-memory cache."""
    db.add(ConversationHistory(session_id=session_id, role="user", content=query))
    db.add(ConversationHistory(session_id=session_id, role="assistant", content=answer[:2000]))
    await db.commit()

    _cache[session_id].append({"role": "user", "content": query})
    _cache[session_id].append({"role": "assistant", "content": answer[:2000]})
    log.info("[memory] saved exchange for session=%s", session_id)


def get_cached_history(session_id: str) -> list[dict]:
    """Fast in-memory history lookup (no DB hit)."""
    return list(_cache[session_id])
