from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from raincheck_weather.app import app


client = TestClient(app)


@pytest.mark.parametrize(
    "route,payload,expected_mime,expected_fragment",
    [
        (
            "/artifacts/brief-report",
            {
                "artifactType": "brief-report",
                "locationQuery": "Austin, TX",
                "prompt": "Summarize the next 12 hours",
                "sections": ["Situation", "Impacts", "Uncertainty"],
            },
            "text/html",
            "Brief weather report",
        ),
        (
            "/artifacts/radar-loop",
            {
                "artifactType": "radar-loop",
                "locationQuery": "Dallas, TX",
                "prompt": "Storm evolution",
                "frames": [
                    {
                        "label": "Frame 1",
                        "description": "Storm cluster approaching",
                    },
                    {
                        "label": "Frame 2",
                        "description": "Strongest reflectivity core",
                    },
                ],
            },
            "text/html",
            "RainCheck Radar Loop",
        ),
        (
            "/artifacts/satellite-loop",
            {
                "artifactType": "satellite-loop",
                "locationQuery": "Miami, FL",
                "prompt": "Cloud-top evolution",
                "frames": [
                    {"label": "IR 1", "description": "Afternoon convection"},
                    {"label": "IR 2", "description": "Anvil expansion"},
                ],
            },
            "text/html",
            "RainCheck Satellite Loop",
        ),
        (
            "/artifacts/model-comparison-panel",
            {
                "artifactType": "model-comparison-panel",
                "locationQuery": "Tulsa, OK",
                "prompt": "Compare guidance for the evening storm window",
                "comparisonModels": [
                    {
                        "sourceId": "ncep-models",
                        "modelLabel": "HRRR",
                        "summary": "Most aggressive convective timing.",
                        "confidence": "medium",
                    },
                    {
                        "sourceId": "ecmwf-open-data",
                        "modelLabel": "ECMWF",
                        "summary": "Slower and a bit farther south.",
                        "confidence": "high",
                    },
                ],
            },
            "image/svg+xml",
            "HRRR",
        ),
        (
            "/artifacts/hydrograph",
            {
                "artifactType": "hydrograph",
                "locationQuery": "Arkansas River",
                "prompt": "River rise over the next day",
                "chartPoints": [
                    {"label": "Now", "value": 8.0},
                    {"label": "+6h", "value": 9.4},
                    {"label": "+12h", "value": 11.2},
                ],
            },
            "image/svg+xml",
            "RainCheck Hydrograph",
        ),
        (
            "/artifacts/skewt",
            {
                "artifactType": "skewt",
                "locationQuery": "Norman, OK",
                "prompt": "Sounding profile",
                "soundingLevels": [
                    {
                        "pressureHpa": 1000.0,
                        "temperatureC": 24.0,
                        "dewpointC": 19.0,
                    },
                    {
                        "pressureHpa": 850.0,
                        "temperatureC": 18.0,
                        "dewpointC": 11.0,
                    },
                    {
                        "pressureHpa": 700.0,
                        "temperatureC": 8.0,
                        "dewpointC": 2.0,
                    },
                ],
            },
            "image/svg+xml",
            "RainCheck Skew-T",
        ),
        (
            "/artifacts/rainfall-chart",
            {
                "artifactType": "rainfall-chart",
                "locationQuery": "Little Rock, AR",
                "prompt": "Rainfall totals",
                "chartPoints": [
                    {"label": "0h", "value": 0.2},
                    {"label": "6h", "value": 1.1},
                    {"label": "12h", "value": 2.0},
                ],
            },
            "image/svg+xml",
            "RainCheck Rainfall Chart",
        ),
        (
            "/artifacts/snowfall-chart",
            {
                "artifactType": "snowfall-chart",
                "locationQuery": "Denver, CO",
                "prompt": "Snowfall totals",
                "chartPoints": [
                    {"label": "0h", "value": 0.0},
                    {"label": "12h", "value": 3.0},
                    {"label": "24h", "value": 6.0},
                ],
            },
            "image/svg+xml",
            "RainCheck Snowfall Chart",
        ),
    ],
)
def test_generated_artifact_routes(
    tmp_path: Path,
    monkeypatch,
    route: str,
    payload: dict,
    expected_mime: str,
    expected_fragment: str,
) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))

    response = client.post(route, json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["mimeType"] == expected_mime
    assert body["artifactType"] == payload["artifactType"]
    assert (tmp_path / body["artifactId"]).exists()
    assert expected_fragment in (tmp_path / body["artifactId"]).read_text(encoding="utf-8")
