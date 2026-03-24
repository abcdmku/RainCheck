from pathlib import Path

from raincheck_weather.artifacts import generate_meteogram, generate_report
from raincheck_weather.models import ArtifactRequest
from raincheck_weather.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        artifacts_dir=tmp_path,
        public_base_path="/api/artifacts",
        nws_base_url="https://api.weather.gov",
        nws_user_agent="pytest",
        request_timeout_seconds=5.0,
    )


def test_generate_meteogram_writes_svg(tmp_path: Path) -> None:
    response = generate_meteogram(
        _settings(tmp_path),
        ArtifactRequest(
            artifactType="meteogram",
            locationQuery="Austin, TX",
            prompt="Next 12 hours",
            chartPoints=[
                {"label": "Now", "value": 72.0},
                {"label": "+3h", "value": 74.0},
                {"label": "+6h", "value": 70.0},
            ],
        ),
    )

    assert response.mimeType == "image/svg+xml"
    assert response.artifactType == "meteogram"
    assert (tmp_path / response.artifactId).exists()


def test_generate_report_writes_html(tmp_path: Path) -> None:
    response = generate_report(
        _settings(tmp_path),
        ArtifactRequest(
            artifactType="research-report",
            locationQuery="Chicago, IL",
            prompt="Storm timing and rainfall context",
            sections=["Situation", "Official baseline", "Confidence"],
        ),
    )

    assert response.mimeType == "text/html"
    assert response.artifactType == "research-report"
    assert (tmp_path / response.artifactId).read_text(encoding="utf-8").startswith(
        "<!doctype html>"
    )
