from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from backend.core.config import settings


def _connect_args() -> dict:
    """Build asyncpg connect args for Neon / pooler compatibility.

    - Remote hosts (not localhost) → ssl=require, otherwise Render/Neon will reset
      the connection and logs show "Connect call failed (::1, 5432)" / "connection is closed".
    - Poolers (pooler. / -pooler. hosts, e.g. Neon/Supabase) → prepared_statement_cache_size=0
      because pgbouncer/pooler does not support prepared statements and asyncpg would 400.
    - Shared schema → search_path pinned to researchos (see _connect_args doc above).
    """
    args: dict = {}
    url = settings.postgres_url
    is_remote = not any(h in url for h in ("localhost", "127.0.0.1"))
    is_pooler = any(k in url for k in ("pooler.", "-pooler."))

    if is_remote:
        args["ssl"] = "require"
    if is_pooler:
        args["prepared_statement_cache_size"] = 0

    if settings.postgres_schema != "public":
        args["server_settings"] = {"search_path": settings.postgres_schema}
    return args


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
