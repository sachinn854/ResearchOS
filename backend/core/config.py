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
    llm_model: str = Field(
        default="meta-llama/llama-3.3-70b-instruct:free",
        description="OpenRouter model ID — use :free suffix for free models"
    )
    fast_llm_model: str = Field(
        default="google/gemma-3-4b-it:free",
        description="Smaller/faster model for domain check, HyDE — set FAST_LLM_MODEL in .env"
    )
    llm_provider: str | None = Field(
        default=None,
        description="OpenRouter provider preference e.g. 'Fireworks', 'Together', 'DeepInfra'. None = OpenRouter auto-selects."
    )

    # Databases
    postgres_url: str = Field(description="Async PostgreSQL connection string")
    qdrant_url: str = Field(description="Qdrant vector DB URL")
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


settings = Settings()
