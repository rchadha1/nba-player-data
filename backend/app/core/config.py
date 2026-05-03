from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    database_url: str = ""                 # Supabase postgres connection string (Transaction mode)
    supabase_url: str = ""                 # https://xxxx.supabase.co
    supabase_jwt_secret: str = ""          # legacy HS256 secret (unused if public key is set)
    supabase_jwt_public_key: str = ""      # ES256 public key as JSON string (Settings > API > JWT Settings)
    balldontlie_api_key: str = ""
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:8081"]
    anthropic_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
