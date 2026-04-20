from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./mathion.db"
    asset_path: str = "/data/mathion/assets"
    max_file_size: int = 20 * 1024 * 1024  # 20MB
    max_course_size: int = 500 * 1024 * 1024  # 500MB

    model_config = {"env_prefix": "MATHION_"}


settings = Settings()
