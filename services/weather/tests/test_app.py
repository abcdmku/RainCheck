from __future__ import annotations

from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from raincheck_weather.app import app, get_nws_service
from raincheck_weather.nws import NwsService
from raincheck_weather.settings import Settings


def _mock_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        query = str(request.url.query)

        if path.startswith("/points/"):
            return httpx.Response(
                200,
                json={
                    "properties": {
                        "forecast": "https://api.weather.gov/gridpoints/OUN/1,1/forecast",
                        "forecastHourly": "https://api.weather.gov/gridpoints/OUN/1,1/forecast/hourly",
                        "observationStations": "https://api.weather.gov/gridpoints/OUN/1,1/stations",
                        "relativeLocation": {
                            "properties": {"city": "Oklahoma City", "state": "OK"}
                        },
                    }
                },
            )

        if path == "/gridpoints/OUN/1,1/stations":
            return httpx.Response(
                200,
                json={
                    "features": [
                        {
                            "id": "https://api.weather.gov/stations/KOKC",
                            "properties": {
                                "stationIdentifier": "KOKC",
                                "name": "Oklahoma City Station",
                            },
                        }
                    ]
                },
            )

        if path == "/stations/KOKC/observations/latest":
            return httpx.Response(
                200,
                json={
                    "properties": {
                        "timestamp": "2026-03-24T12:00:00+00:00",
                        "textDescription": "Mostly Cloudy",
                        "icon": "https://example.com/icon.png",
                        "temperature": {"value": 18.3, "unitCode": "wmoUnit:degC"},
                        "dewpoint": {"value": 13.0, "unitCode": "wmoUnit:degC"},
                        "relativeHumidity": {"value": 73.0, "unitCode": "wmoUnit:percent"},
                        "windSpeed": {"value": 7.0, "unitCode": "wmoUnit:km_h-1"},
                        "windDirection": {"value": 180.0, "unitCode": "wmoUnit:degree_(angle)"},
                        "barometricPressure": {"value": 100900.0, "unitCode": "wmoUnit:Pa"},
                        "visibility": {"value": 16093.0, "unitCode": "wmoUnit:m"},
                    }
                },
            )

        if path == "/gridpoints/OUN/1,1/forecast/hourly":
            return httpx.Response(
                200,
                json={
                    "properties": {
                        "periods": [
                            {
                                "name": "This Hour",
                                "startTime": "2026-03-24T12:00:00+00:00",
                                "endTime": "2026-03-24T13:00:00+00:00",
                                "isDaytime": True,
                                "temperature": 65,
                                "temperatureUnit": "F",
                                "probabilityOfPrecipitation": {
                                    "value": 20.0,
                                    "unitCode": "wmoUnit:percent",
                                },
                                "windSpeed": "10 mph",
                                "windDirection": "S",
                                "shortForecast": "Chance Showers",
                                "detailedForecast": "A few showers nearby.",
                                "icon": "https://example.com/forecast.png",
                            }
                        ]
                    }
                },
            )

        if path == "/alerts/active" and "point=35.4676%2C-97.5164" in query:
            return httpx.Response(
                200,
                json={
                    "features": [
                        {
                            "id": "https://api.weather.gov/alerts/abc",
                            "properties": {
                                "event": "Flood Watch",
                                "severity": "Moderate",
                                "certainty": "Likely",
                                "urgency": "Future",
                                "headline": "Flood Watch issued March 24 at 7:00 AM CDT",
                                "description": "Heavy rain may cause flooding.",
                                "instruction": "Monitor later forecasts.",
                                "effective": "2026-03-24T12:00:00+00:00",
                                "ends": "2026-03-25T12:00:00+00:00",
                                "senderName": "NWS Norman OK",
                            },
                        }
                    ]
                },
            )

        return httpx.Response(404, json={"detail": "unexpected request"})

    return httpx.MockTransport(handler)


def _override_service() -> NwsService:
    settings = Settings(
        artifacts_dir=Path("artifacts"),
        public_base_path="/api/artifacts",
        nws_base_url="https://api.weather.gov",
        nws_user_agent="pytest",
        request_timeout_seconds=5.0,
    )
    return NwsService(settings=settings, transport=_mock_transport())


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert "nws-forecast" in body["implementedProducts"]
    assert "derive-short-range" in body["implementedProducts"]
    assert "brief-report" in body["artifactTypes"]
    assert "radar-loop" in body["artifactTypes"]
    assert "single-model-panel" in body["artifactTypes"]
    assert "hodograph" in body["artifactTypes"]
    assert "time-height-chart" in body["artifactTypes"]


def test_catalog() -> None:
    response = client.get("/catalog")

    assert response.status_code == 200
    body = response.json()
    assert any(source["sourceId"] == "nws" for source in body["sources"])
    assert any(source["sourceId"] == "raincheck-artifacts" for source in body["sources"])
    assert any(source["sourceId"] == "raincheck-derivation" for source in body["sources"])
    assert any(source["sourceId"] == "wpc" for source in body["sources"])
    assert any(source["sourceId"] == "nhc" for source in body["sources"])
    assert any(
        product["productId"] == "artifact-brief-report"
        and product["sourceId"] == "raincheck-artifacts"
        for product in body["products"]
    )
    assert any(
        product["productId"] == "artifact-single-model-panel"
        and product["sourceId"] == "raincheck-artifacts"
        for product in body["products"]
    )
    assert any(product["productId"] == "wpc-qpf-ero" for product in body["products"])


def test_weather_analysis_endpoint() -> None:
    app.dependency_overrides[get_nws_service] = _override_service
    try:
        response = client.post(
            "/weather/analysis",
            json={
                "location": {
                    "latitude": 35.4676,
                    "longitude": -97.5164,
                    "name": "Oklahoma City, OK",
                },
                "prompt": "Summarize the next 24 hours",
                "includeForecast": True,
                "includeHourlyForecast": True,
                "includeAlerts": True,
                "forecastPeriods": 1,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["location"]["name"] == "Oklahoma City, OK"
    assert body["forecast"][0]["name"] == "This Hour"
    assert body["alerts"][0]["event"] == "Flood Watch"
    assert "nws-hourly-forecast" in body["normalizedProducts"]
    assert body["citations"]


def test_report_endpoint(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))
    response = client.post(
        "/artifacts/research-report",
        json={
            "artifactType": "research-report",
            "locationQuery": "Oklahoma City, OK",
            "prompt": "Summarize the next 24 hours",
            "sections": ["Situation", "Forecast", "Risks"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mimeType"] == "text/html"
    assert (tmp_path / body["artifactId"]).exists()
