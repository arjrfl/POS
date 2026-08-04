from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int
    ENVIRONMENT: str = "development"

    # End-of-day auto-void scheduler (see app/services/scheduler_service.py) —
    # server-local time, 24h clock
    END_OF_DAY_VOID_HOUR: int = 23
    END_OF_DAY_VOID_MINUTE: int = 59

    # Comma-separated list of allowed CORS origins. Defaults to the
    # nginx-served dev-laptop origin (see CLAUDE.md Frontend Deploy Notes:
    # verification always goes through http://localhost, never the Vite dev
    # server). Never falls back to "*" — see cors_origins below.
    CORS_ALLOWED_ORIGINS: str = "http://localhost"

    @property
    def cors_origins(self) -> list[str]:
        origins = [origin.strip() for origin in self.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]
        if not origins:
            raise ValueError(
                "CORS_ALLOWED_ORIGINS is set but parsed to an empty list — refusing to "
                "start with a permissive/empty CORS origin list. Set it to a "
                "comma-separated list of allowed origins, e.g. "
                "http://meatshop.local,http://192.168.1.58"
            )
        return origins


settings = Settings()
