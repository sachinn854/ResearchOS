from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from backend.core.config import settings


def _connect_args() -> dict:
    """Pin every connection's search_path when a non-default schema is configured.

    All our SQL — ORM and raw text() alike — uses unqualified table names, so
    search_path is what decides which schema they land in.

    Note that `public` is deliberately NOT included as a fallback. If it were, a
    table missing from our schema would silently resolve to a same-named table in
    public — which, on a database shared with another app, means quietly reading
    or writing someone else's `documents` or `users`. Better to fail loudly.
    """
    if settings.postgres_schema == "public":
        return {}
    return {"server_settings": {"search_path": settings.postgres_schema}}


engine = create_async_engine(
    settings.postgres_url,
    echo=settings.app_env == "development",
    pool_size=10,
    max_overflow=20,

    # Both of these exist because the database is behind Supabase's connection
    # pooler, which closes connections it considers idle without telling us. Our
    # pool then hands out a socket the server has already hung up on, and the
    # first statement raises `asyncpg InterfaceError: connection is closed`.
    #
    # The symptom was not obviously a database problem: /research/sessions
    # returned 500 intermittently, the frontend swallowed it, and the sidebar
    # just showed "No chats yet" — so it read as the chat history having been
    # lost rather than as one failed request.
    #
    # pool_pre_ping issues a cheap liveness check before handing a connection
    # over and transparently replaces a dead one. pool_recycle retires
    # connections before the pooler's own idle timeout can get to them, so the
    # pre-ping path stays the exception rather than the norm.
    pool_pre_ping=True,
    pool_recycle=300,

    connect_args=_connect_args(),
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    """FastAPI dependency that provides a database session per request."""
    async with AsyncSessionLocal() as session:
        yield session
