from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./mathion.db"
    asset_path: str = "/data/mathion/assets"
    max_file_size: int = 20 * 1024 * 1024  # 20MB
    max_course_size: int = 500 * 1024 * 1024  # 500MB
    secret_key: str = "dev-secret-key-change-in-production"
    pin_expiry_minutes: int = 10
    max_pin_requests_per_hour: int = 3
    max_pin_failures_per_hour: int = 5

    model_config = {"env_prefix": "MATHION_"}


settings = Settings()
