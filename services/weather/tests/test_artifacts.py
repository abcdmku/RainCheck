from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from raincheck_weather.app import app


client = TestClient(app)


def _evidence_product() -> dict:
    return {
        "id": "hrrr-1",
        "sourceFamily": "hrrr",
        "sourceName": "HRRR",
        "cycleTime": "2026-03-24T12:00:00Z",
        "validTime": "2026-03-24T15:00:00Z",
        "geometry": {
            "type": "point",
            "latitude": 35.4676,
            "longitude": -97.5164,
            "label": "Oklahoma City, OK",
        },
        "fieldName": "cape",
        "fieldType": "derived_diagnostic",
        "level": "surface",
        "units": "J/kg",
        "spatialResolution": "3 km",
        "summary": "Instability favors scattered supercells.",
        "summaryStats": {"cape": 2400.0},
        "signalScore": 0.88,
        "confidence": 0.84,
        "provenance": [
            {
                "sourceId": "hrrr",
                "productId": "hrrr-cape",
                "label": "HRRR CAPE subset",
                "retrievedAt": "2026-03-24T12:05:00Z",
                "validAt": "2026-03-24T15:00:00Z",
                "url": "https://example.com/hrrr-cape",
            }
        ],
        "artifactHandles": [],
    }


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
        (
            "/artifacts/single-model-panel",
            {
                "artifactType": "single-model-panel",
                "locationQuery": "Oklahoma City, OK",
                "prompt": "Summarize the severe-weather evidence",
                "evidenceProducts": [_evidence_product()],
            },
            "text/html",
            "Single model panel",
        ),
        (
            "/artifacts/hodograph",
            {
                "artifactType": "hodograph",
                "locationQuery": "Norman, OK",
                "prompt": "Storm-relative wind profile",
                "soundingLevels": [
                    {
                        "pressureHpa": 1000.0,
                        "windSpeedKt": 10.0,
                        "windDirectionDeg": 160.0,
                    },
                    {
                        "pressureHpa": 850.0,
                        "windSpeedKt": 25.0,
                        "windDirectionDeg": 190.0,
                    },
                    {
                        "pressureHpa": 700.0,
                        "windSpeedKt": 45.0,
                        "windDirectionDeg": 220.0,
                    },
                ],
            },
            "image/svg+xml",
            "RainCheck Hodograph",
        ),
        (
            "/artifacts/time-height-chart",
            {
                "artifactType": "time-height-chart",
                "locationQuery": "Norman, OK",
                "prompt": "Wind and thermodynamic profile",
                "soundingLevels": [
                    {
                        "pressureHpa": 1000.0,
                        "temperatureC": 24.0,
                        "dewpointC": 19.0,
                        "windSpeedKt": 10.0,
                    },
                    {
                        "pressureHpa": 850.0,
                        "temperatureC": 18.0,
                        "dewpointC": 11.0,
                        "windSpeedKt": 24.0,
                    },
                    {
                        "pressureHpa": 700.0,
                        "temperatureC": 9.0,
                        "dewpointC": 4.0,
                        "windSpeedKt": 40.0,
                    },
                ],
            },
            "image/svg+xml",
            "RainCheck Time-Height Chart",
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


@pytest.mark.parametrize(
    "route,payload",
    [
        (
            "/artifacts/radar-loop",
            {
                "artifactType": "radar-loop",
                "locationQuery": "Dallas, TX",
                "prompt": "Storm evolution",
            },
        ),
        (
            "/artifacts/single-model-panel",
            {
                "artifactType": "single-model-panel",
                "locationQuery": "Oklahoma City, OK",
                "prompt": "Summarize the severe-weather evidence",
            },
        ),
        (
            "/artifacts/hodograph",
            {
                "artifactType": "hodograph",
                "locationQuery": "Norman, OK",
                "prompt": "Storm-relative wind profile",
            },
        ),
    ],
)
def test_artifacts_require_real_inputs(route: str, payload: dict) -> None:
    response = client.post(route, json=payload)

    assert response.status_code == 422
