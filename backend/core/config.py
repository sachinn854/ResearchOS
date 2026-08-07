from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # LLM — OpenRouter
    openrouter_api_key: str = Field(description="OpenRouter API key")
    # BUG-038: these defaults must match .env / .env.example. Earlier the code
    # defaulted to llama-3.3-70b while .env used gpt-oss-120b — so anyone running
    # without a .env got a silently different (weaker) model than the one we tuned
    # prompts and thresholds against.
    llm_model: str = Field(
        default="openai/gpt-oss-120b",
        description="Main generation model — OpenRouter model ID. Override with LLM_MODEL in .env"
    )
    fast_llm_model: str = Field(
        default="openai/gpt-oss-20b:free",
        description="Smaller/faster model for domain check, HyDE, entity extraction — set FAST_LLM_MODEL in .env"
    )
    llm_provider: str | None = Field(
        default=None,
        description="OpenRouter provider preference e.g. 'Fireworks', 'Together', 'DeepInfra'. None = OpenRouter auto-selects."
    )
    vision_llm_model: str = Field(
        default="meta-llama/llama-3.2-11b-vision-instruct",
        description="Vision-capable model for PDF image description. Set VISION_LLM_MODEL in .env to override."
    )

    # Databases
    postgres_url: str = Field(description="Async PostgreSQL connection string")
    postgres_schema: str = Field(
        default="public",
        description=(
            "Postgres schema to keep ResearchOS tables in. Set this when the database is shared "
            "with another application — ResearchOS uses generic names (documents, users, chunks) "
            "that would otherwise collide. The schema is created automatically by the migration "
            "run, and search_path is pinned to it alone (no public fallback) so a missing table "
            "raises instead of silently reading the other app's data."
        )
    )
    qdrant_url: str = Field(description="Qdrant vector DB URL")
    qdrant_api_key: str | None = Field(default=None, description="Qdrant Cloud API key")
    qdrant_collection: str = Field(
        default="researchos_chunks",
        description="Qdrant collection name for storing chunk vectors"
    )
    redis_url: str = Field(description="Redis connection URL")

    # Embedding
    embedding_model: str = Field(
        default="BAAI/bge-small-en-v1.5",
        description="Local sentence-transformers model — no API key required"
    )
    embedding_dimension: int = Field(
        default=384,
        description="Output dimension of the embedding model — must match Qdrant collection size"
    )

    # Auth
    # No default on purpose. A fallback secret would be committed to the repo,
    # and anyone holding it could mint valid tokens for any account — so the app
    # refuses to start rather than run with a known key.
    jwt_secret_key: str = Field(
        description="Secret used to sign JWTs. Generate with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )
    jwt_algorithm: str = Field(default="HS256", description="JWT signing algorithm")
    access_token_expire_minutes: int = Field(
        default=60 * 24 * 7,
        description=(
            "Token lifetime in minutes (default 7 days). There is no refresh token and no "
            "revocation list, so this is also how long a stolen token stays usable — shorten it "
            "if that matters more than users staying signed in."
        )
    )

    # Ingestion feature flags
    enable_image_description: bool = Field(
        default=True,
        description=(
            "Describe images found in PDFs with the vision model and append the description to the "
            "page text. Set ENABLE_IMAGE_DESCRIPTION=false to skip it — worth doing when the "
            "configured vision model is unavailable, since every image then costs a failing HTTP "
            "call that is swallowed and logged at debug level."
        )
    )
    enable_entity_extraction: bool = Field(
        default=True,
        description=(
            "Extract entities per chunk during ingestion to power the graph retrieval signal. "
            "Costs one batched LLM call per 5 chunks — set ENABLE_ENTITY_EXTRACTION=false to "
            "make ingestion cheaper and faster at the cost of losing the graph signal."
        )
    )

    # Langfuse (optional — leave empty to disable tracing)
    langfuse_public_key: str | None = Field(default=None, description="Langfuse public key for LLM tracing")
    langfuse_secret_key: str | None = Field(default=None, description="Langfuse secret key")
    langfuse_host: str = Field(default="https://cloud.langfuse.com", description="Langfuse host URL")

    # Web Search (optional — Tavily for Adaptive KB)
    tavily_api_key: str | None = Field(default=None, description="Tavily API key for web search fallback")

    # App
    app_env: str = Field(
        default="development",
        description="Runtime environment: development | production"
    )
    cors_origins: str = Field(
        default="http://localhost:3000",
        description=(
            "Comma-separated list of origins allowed to call this API. This was hardcoded to "
            "localhost:3000, so a deployed frontend got blocked by the browser with no server-side "
            "error to explain it. Set CORS_ORIGINS to your frontend's URL in production, e.g. "
            "https://researchos.up.railway.app — no trailing slash, the origin must match exactly."
        )
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
