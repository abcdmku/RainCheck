from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    artifacts_dir: Path
    public_base_path: str
    nws_base_url: str
    nws_user_agent: str
    request_timeout_seconds: float


def load_settings() -> Settings:
    service_root = Path(__file__).resolve().parents[2]
    artifacts_dir = Path(
        os.getenv("ARTIFACTS_DIR", service_root / "artifacts" / "generated")
    )
    public_base_path = os.getenv("WEATHER_ARTIFACT_BASE_PATH", "/api/artifacts")
    nws_base_url = os.getenv("NWS_BASE_URL", "https://api.weather.gov").rstrip("/")
    nws_user_agent = os.getenv(
        "NWS_USER_AGENT",
        "raincheck.chat weather-service (local-dev@example.com)",
    )
    request_timeout_seconds = float(os.getenv("WEATHER_HTTP_TIMEOUT_SECONDS", "15"))
    return Settings(
        artifacts_dir=artifacts_dir,
        public_base_path=public_base_path,
        nws_base_url=nws_base_url,
        nws_user_agent=nws_user_agent,
        request_timeout_seconds=request_timeout_seconds,
    )
