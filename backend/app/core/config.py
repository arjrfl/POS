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


settings = Settings()
