from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/nba_betting"
    balldontlie_api_key: str = ""
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:8081"]

    class Config:
        env_file = ".env"


settings = Settings()
