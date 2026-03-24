from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from raincheck_weather.models import (
    AlertsRequest,
    CurrentWeatherRequest,
    ForecastRequest,
    LocationContext,
)
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
                            "properties": {"city": "Norman", "state": "OK"}
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
                            "id": "https://api.weather.gov/stations/KOUN",
                            "properties": {
                                "stationIdentifier": "KOUN",
                                "name": "Norman Station",
                            },
                        }
                    ]
                },
            )

        if path == "/stations/KOUN/observations/latest":
            return httpx.Response(
                200,
                json={
                    "properties": {
                        "timestamp": "2026-03-24T12:00:00+00:00",
                        "textDescription": "Sunny",
                        "temperature": {"value": 20.0, "unitCode": "wmoUnit:degC"},
                        "windSpeed": {"value": 12.0, "unitCode": "wmoUnit:km_h-1"},
                    }
                },
            )

        if path == "/gridpoints/OUN/1,1/forecast":
            return httpx.Response(
                200,
                json={
                    "properties": {
                        "periods": [
                            {
                                "name": "Today",
                                "startTime": "2026-03-24T12:00:00+00:00",
                                "endTime": "2026-03-24T18:00:00+00:00",
                                "isDaytime": True,
                                "temperature": 71,
                                "temperatureUnit": "F",
                                "probabilityOfPrecipitation": {
                                    "value": 10.0,
                                    "unitCode": "wmoUnit:percent",
                                },
                                "windSpeed": "10 mph",
                                "windDirection": "SW",
                                "shortForecast": "Sunny",
                                "detailedForecast": "Sunny with light southwest wind.",
                            }
                        ]
                    }
                },
            )

        if path == "/alerts/active" and "point=35.2226%2C-97.4395" in query:
            return httpx.Response(200, json={"features": []})

        return httpx.Response(404, json={"detail": "unexpected request"})

    return httpx.MockTransport(handler)


def _service() -> NwsService:
    settings = Settings(
        artifacts_dir=Path("."),
        public_base_path="/api/artifacts",
        nws_base_url="https://api.weather.gov",
        nws_user_agent="pytest",
        request_timeout_seconds=5.0,
    )
    return NwsService(settings=settings, transport=_mock_transport())


@pytest.mark.asyncio
async def test_get_current_conditions_normalizes_station_observation() -> None:
    service = _service()
    response = await service.get_current_conditions(
        CurrentWeatherRequest(
            location=LocationContext(latitude=35.2226, longitude=-97.4395)
        )
    )

    assert response.location.name == "Norman, OK"
    assert response.current is not None
    assert response.current.stationId == "KOUN"
    assert response.current.temperature is not None
    assert response.current.temperature.value == 20.0
    assert response.citations[0].productId == "nws-observation"


@pytest.mark.asyncio
async def test_get_forecast_returns_requested_periods() -> None:
    service = _service()
    response = await service.get_forecast(
        ForecastRequest(
            location=LocationContext(latitude=35.2226, longitude=-97.4395),
            periods=1,
        )
    )

    assert len(response.forecast) == 1
    assert response.forecast[0].name == "Today"
    assert response.citations[0].productId == "nws-forecast"


@pytest.mark.asyncio
async def test_get_alerts_handles_empty_active_alert_set() -> None:
    service = _service()
    response = await service.get_alerts(
        AlertsRequest(
            location=LocationContext(latitude=35.2226, longitude=-97.4395)
        )
    )

    assert response.alerts == []
    assert "No active NWS alerts" in response.notes[0]
