from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from .errors import ServiceError
from .models import (
    AlertSummary,
    AlertsRequest,
    AlertsResponse,
    CitationBundle,
    CurrentConditions,
    CurrentWeatherRequest,
    CurrentWeatherResponse,
    ForecastPeriod,
    ForecastRequest,
    ForecastResponse,
    LocationContext,
    Measurement,
    WeatherAnalysisRequest,
    WeatherAnalysisResponse,
)
from .settings import Settings


@dataclass(frozen=True)
class PointContext:
    location: LocationContext
    forecast_url: str
    forecast_hourly_url: str
    observation_stations_url: str


class NwsService:
    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport

    async def get_current_conditions(
        self, payload: CurrentWeatherRequest
    ) -> CurrentWeatherResponse:
        async with self._client() as client:
            point = await self._resolve_point(client, payload.location)
            current, notes, citations = await self._fetch_current(client, point)
            return CurrentWeatherResponse(
                location=point.location,
                current=current,
                notes=notes,
                citations=citations,
            )

    async def get_forecast(self, payload: ForecastRequest) -> ForecastResponse:
        async with self._client() as client:
            point = await self._resolve_point(client, payload.location)
            forecast, notes, citations = await self._fetch_forecast(
                client,
                point,
                hourly=payload.hourly,
                periods=payload.periods,
            )
            return ForecastResponse(
                location=point.location,
                hourly=payload.hourly,
                forecast=forecast,
                notes=notes,
                citations=citations,
            )

    async def get_alerts(self, payload: AlertsRequest) -> AlertsResponse:
        async with self._client() as client:
            point = await self._resolve_point(client, payload.location)
            alerts, notes, citations = await self._fetch_alerts(client, point.location)
            return AlertsResponse(
                location=point.location,
                alerts=alerts,
                notes=notes,
                citations=citations,
            )

    async def analyze(self, payload: WeatherAnalysisRequest) -> WeatherAnalysisResponse:
        async with self._client() as client:
            point = await self._resolve_point(client, payload.location)
            current, current_notes, current_citations = await self._fetch_current(
                client, point
            )

            forecast: list[ForecastPeriod] = []
            forecast_notes: list[str] = []
            forecast_citations: list[CitationBundle] = []
            if payload.includeForecast:
                forecast, forecast_notes, forecast_citations = await self._fetch_forecast(
                    client,
                    point,
                    hourly=payload.includeHourlyForecast,
                    periods=payload.forecastPeriods,
                )

            alerts: list[AlertSummary] = []
            alert_notes: list[str] = []
            alert_citations: list[CitationBundle] = []
            if payload.includeAlerts:
                alerts, alert_notes, alert_citations = await self._fetch_alerts(
                    client, point.location
                )

            return WeatherAnalysisResponse(
                location=point.location,
                summary=self._build_summary(current, forecast, alerts),
                uncertaintyNotes=self._build_uncertainty_notes(
                    current_notes + forecast_notes + alert_notes, payload
                ),
                normalizedProducts=self._build_product_manifest(payload),
                current=current,
                forecast=forecast,
                alerts=alerts,
                citations=current_citations + forecast_citations + alert_citations,
            )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=self.settings.request_timeout_seconds,
            headers={
                "User-Agent": self.settings.nws_user_agent,
                "Accept": "application/geo+json, application/json",
            },
            transport=self.transport,
        )

    async def _resolve_point(
        self, client: httpx.AsyncClient, location: LocationContext
    ) -> PointContext:
        point_url = (
            f"{self.settings.nws_base_url}/points/"
            f"{location.latitude:.4f},{location.longitude:.4f}"
        )
        payload = await self._get_json(client, point_url)
        properties = payload.get("properties", {})
        relative = properties.get("relativeLocation", {}).get("properties", {})
        city = relative.get("city")
        state = relative.get("state")
        name = location.name or ", ".join(part for part in [city, state] if part)

        return PointContext(
            location=LocationContext(
                latitude=location.latitude,
                longitude=location.longitude,
                name=name or location.display_name(),
                timezone=location.timezone,
            ),
            forecast_url=properties.get("forecast", ""),
            forecast_hourly_url=properties.get("forecastHourly", ""),
            observation_stations_url=properties.get("observationStations", ""),
        )

    async def _fetch_current(
        self,
        client: httpx.AsyncClient,
        point: PointContext,
    ) -> tuple[CurrentConditions | None, list[str], list[CitationBundle]]:
        if not point.observation_stations_url:
            return None, ["NWS did not return an observation station list for this point."], []

        stations_payload = await self._get_json(client, point.observation_stations_url)
        features = stations_payload.get("features", [])
        if not features:
            return (
                None,
                ["No nearby NWS observation stations were available for this point."],
                [],
            )

        station = features[0]
        station_id = station.get("properties", {}).get("stationIdentifier")
        station_name = station.get("properties", {}).get("name")
        station_url = station.get("id")
        if not station_url:
            raise ServiceError(502, "nws_station_missing_url", "NWS station response was incomplete.")

        observation_payload = await self._get_json(
            client, f"{station_url}/observations/latest"
        )
        properties = observation_payload.get("properties", {})
        observed_at = _parse_datetime(properties.get("timestamp"))
        current = CurrentConditions(
            stationId=station_id,
            stationName=station_name,
            observedAt=observed_at,
            textDescription=properties.get("textDescription"),
            icon=properties.get("icon"),
            temperature=_measurement(properties.get("temperature")),
            dewpoint=_measurement(properties.get("dewpoint")),
            relativeHumidity=_measurement(properties.get("relativeHumidity")),
            windSpeed=_measurement(properties.get("windSpeed")),
            windDirection=_measurement(properties.get("windDirection")),
            barometricPressure=_measurement(properties.get("barometricPressure")),
            visibility=_measurement(properties.get("visibility")),
        )
        citations = [
            CitationBundle(
                sourceId="nws",
                productId="nws-observation",
                label=f"NWS latest observation from {station_id or 'nearest station'}",
                official=True,
                fetchedAt=_utcnow(),
                validAt=observed_at,
                url=f"{station_url}/observations/latest",
            )
        ]
        notes: list[str] = []
        if observed_at is None:
            notes.append("Observation timestamp was missing from the NWS response.")
        else:
            notes.append("Observations come from the nearest available NWS station and can lag local conditions.")

        return current, notes, citations

    async def _fetch_forecast(
        self,
        client: httpx.AsyncClient,
        point: PointContext,
        *,
        hourly: bool,
        periods: int,
    ) -> tuple[list[ForecastPeriod], list[str], list[CitationBundle]]:
        forecast_url = point.forecast_hourly_url if hourly else point.forecast_url
        if not forecast_url:
            note = "Hourly forecast URL was unavailable." if hourly else "Forecast URL was unavailable."
            return [], [note], []

        payload = await self._get_json(client, forecast_url)
        raw_periods = payload.get("properties", {}).get("periods", [])
        forecast = [
            ForecastPeriod(
                name=item.get("name", "Unnamed period"),
                startTime=_parse_datetime(item.get("startTime")) or _utcnow(),
                endTime=_parse_datetime(item.get("endTime")) or _utcnow(),
                isDaytime=bool(item.get("isDaytime")),
                temperature=item.get("temperature"),
                temperatureUnit=item.get("temperatureUnit"),
                probabilityOfPrecipitation=_measurement(
                    item.get("probabilityOfPrecipitation")
                ),
                windSpeed=item.get("windSpeed"),
                windDirection=item.get("windDirection"),
                shortForecast=item.get("shortForecast", ""),
                detailedForecast=item.get("detailedForecast", ""),
                icon=item.get("icon"),
            )
            for item in raw_periods[:periods]
        ]
        product_id = "nws-hourly-forecast" if hourly else "nws-forecast"
        label = "NWS hourly forecast" if hourly else "NWS forecast"
        citations = [
            CitationBundle(
                sourceId="nws",
                productId=product_id,
                label=label,
                official=True,
                fetchedAt=_utcnow(),
                validAt=forecast[0].startTime if forecast else None,
                url=forecast_url,
            )
        ]
        notes = ["Forecast periods come from the official NWS forecast for this point."]
        return forecast, notes, citations

    async def _fetch_alerts(
        self,
        client: httpx.AsyncClient,
        location: LocationContext,
    ) -> tuple[list[AlertSummary], list[str], list[CitationBundle]]:
        point_param = f"{location.latitude:.4f},{location.longitude:.4f}"
        alerts_url = f"{self.settings.nws_base_url}/alerts/active"
        payload = await self._get_json(client, alerts_url, params={"point": point_param})
        features = payload.get("features", [])
        alerts = [
            AlertSummary(
                id=item.get("id", ""),
                event=item.get("properties", {}).get("event", "Unknown alert"),
                severity=item.get("properties", {}).get("severity"),
                certainty=item.get("properties", {}).get("certainty"),
                urgency=item.get("properties", {}).get("urgency"),
                headline=item.get("properties", {}).get("headline"),
                description=item.get("properties", {}).get("description"),
                instruction=item.get("properties", {}).get("instruction"),
                effective=_parse_datetime(item.get("properties", {}).get("effective")),
                ends=_parse_datetime(item.get("properties", {}).get("ends")),
                sender=item.get("properties", {}).get("senderName"),
            )
            for item in features
        ]
        citations = [
            CitationBundle(
                sourceId="nws",
                productId="nws-alerts",
                label="NWS active alerts",
                official=True,
                fetchedAt=_utcnow(),
                url=f"{alerts_url}?point={point_param}",
            )
        ]
        if alerts:
            notes = ["Alerts are official NWS active alerts for the requested point."]
        else:
            notes = ["No active NWS alerts were returned for this point at fetch time."]

        return alerts, notes, citations

    async def _get_json(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        params: dict[str, str] | None = None,
    ) -> dict:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ServiceError(
                502,
                "nws_upstream_error",
                f"NWS request failed with status {exc.response.status_code}.",
            ) from exc
        except httpx.HTTPError as exc:
            raise ServiceError(
                502,
                "nws_network_error",
                "NWS request could not be completed.",
            ) from exc

        payload = response.json()
        if not isinstance(payload, dict):
            raise ServiceError(502, "nws_invalid_response", "NWS returned a non-object payload.")

        return payload

    def _build_summary(
        self,
        current: CurrentConditions | None,
        forecast: list[ForecastPeriod],
        alerts: list[AlertSummary],
    ) -> list[str]:
        summary: list[str] = []
        if alerts:
            alert_names = ", ".join(alert.event for alert in alerts[:2])
            summary.append(f"Active alerts in effect: {alert_names}.")

        if current and current.temperature and current.temperature.value is not None:
            description = current.textDescription or "Current conditions observed"
            summary.append(
                f"{description} near {current.temperature.value:.1f} {current.temperature.unitCode or ''}".strip()
            )

        if forecast:
            first_period = forecast[0]
            summary.append(
                f"{first_period.name}: {first_period.shortForecast} with temperatures near "
                f"{first_period.temperature or 'unknown'} {first_period.temperatureUnit or ''}".strip()
            )

        if not summary:
            summary.append("Weather analysis data was returned, but no concise summary bullets were available.")

        return summary

    def _build_uncertainty_notes(
        self,
        notes: list[str],
        payload: WeatherAnalysisRequest,
    ) -> list[str]:
        uncertainty = list(dict.fromkeys(notes))
        uncertainty.append("Nearest-station observations may not fully represent microclimates.")
        if payload.includeForecast:
            uncertainty.append("Forecast details should be interpreted as official NWS guidance, not model spread.")

        return uncertainty

    def _build_product_manifest(self, payload: WeatherAnalysisRequest) -> list[str]:
        products = ["nws-observation"]
        if payload.includeForecast:
            products.append(
                "nws-hourly-forecast" if payload.includeHourlyForecast else "nws-forecast"
            )
        if payload.includeAlerts:
            products.append("nws-alerts")

        return products


def _measurement(payload: dict | None) -> Measurement | None:
    if not isinstance(payload, dict):
        return None

    return Measurement(
        value=payload.get("value"),
        unitCode=payload.get("unitCode"),
    )


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
