from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LocationContext(StrictModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    name: str | None = None
    timezone: str | None = None

    def display_name(self) -> str:
        if self.name:
            return self.name

        return f"{self.latitude:.4f}, {self.longitude:.4f}"


class SourceCatalogEntry(StrictModel):
    sourceId: str
    name: str
    official: bool
    authRequired: bool
    geographicCoverage: str
    temporalCoverage: str
    refreshCadence: str
    validTimeSemantics: str
    supportedFormats: list[str]
    unitsNotes: str
    projectionNotes: str | None = None
    latencyNotes: str
    costNotes: str
    recommendedUseCases: list[str]
    implemented: bool = True


class ProductCatalogEntry(StrictModel):
    productId: str
    sourceId: str
    name: str
    category: str
    refreshCadence: str
    validTimeSemantics: str
    supportedFormats: list[str]
    notes: str
    implemented: bool = True


class CatalogResponse(StrictModel):
    sources: list[SourceCatalogEntry]
    products: list[ProductCatalogEntry]


class TimeRange(StrictModel):
    start: datetime
    end: datetime


class WeatherCitation(StrictModel):
    sourceId: str
    productId: str
    label: str
    official: bool
    fetchedAt: datetime
    validAt: datetime | None = None
    validRange: TimeRange | None = None
    url: str | None = None


class ArtifactHandle(StrictModel):
    artifactId: str
    artifactType: str
    title: str
    href: str
    mimeType: str


class WeatherEnvelope(StrictModel):
    sourceId: str
    sourceName: str
    retrievedAt: datetime
    validAt: datetime | None = None
    validRange: TimeRange | None = None
    location: LocationContext | None = None
    units: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    citations: list[WeatherCitation] = Field(default_factory=list)
    artifacts: list[ArtifactHandle] = Field(default_factory=list)


class CitationBundle(StrictModel):
    sourceId: str
    productId: str
    label: str
    official: bool
    fetchedAt: datetime
    validAt: datetime | None = None
    url: str | None = None


class Measurement(StrictModel):
    value: float | None = None
    unitCode: str | None = None


class CurrentConditions(StrictModel):
    stationId: str | None = None
    stationName: str | None = None
    observedAt: datetime | None = None
    textDescription: str | None = None
    icon: str | None = None
    temperature: Measurement | None = None
    dewpoint: Measurement | None = None
    relativeHumidity: Measurement | None = None
    windSpeed: Measurement | None = None
    windDirection: Measurement | None = None
    barometricPressure: Measurement | None = None
    visibility: Measurement | None = None


class ForecastPeriod(StrictModel):
    name: str
    startTime: datetime
    endTime: datetime
    isDaytime: bool
    temperature: float | None = None
    temperatureUnit: str | None = None
    probabilityOfPrecipitation: Measurement | None = None
    windSpeed: str | None = None
    windDirection: str | None = None
    shortForecast: str
    detailedForecast: str
    icon: str | None = None


class AlertSummary(StrictModel):
    id: str
    event: str
    severity: str | None = None
    certainty: str | None = None
    urgency: str | None = None
    headline: str | None = None
    description: str | None = None
    instruction: str | None = None
    effective: datetime | None = None
    ends: datetime | None = None
    sender: str | None = None


class CurrentWeatherRequest(StrictModel):
    location: LocationContext


class CurrentWeatherResponse(StrictModel):
    location: LocationContext
    current: CurrentConditions | None = None
    notes: list[str] = Field(default_factory=list)
    citations: list[CitationBundle] = Field(default_factory=list)


class ForecastRequest(StrictModel):
    location: LocationContext
    hourly: bool = False
    periods: int = Field(default=6, ge=1, le=14)


class ForecastResponse(StrictModel):
    location: LocationContext
    hourly: bool
    forecast: list[ForecastPeriod] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    citations: list[CitationBundle] = Field(default_factory=list)


class AlertsRequest(StrictModel):
    location: LocationContext


class AlertsResponse(StrictModel):
    location: LocationContext
    alerts: list[AlertSummary] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    citations: list[CitationBundle] = Field(default_factory=list)


class WeatherAnalysisRequest(StrictModel):
    location: LocationContext
    prompt: str = Field(min_length=1, max_length=4000)
    includeForecast: bool = True
    includeHourlyForecast: bool = False
    includeAlerts: bool = True
    forecastPeriods: int = Field(default=6, ge=1, le=14)


class WeatherAnalysisResponse(StrictModel):
    location: LocationContext
    summary: list[str] = Field(default_factory=list)
    uncertaintyNotes: list[str] = Field(default_factory=list)
    normalizedProducts: list[str] = Field(default_factory=list)
    current: CurrentConditions | None = None
    forecast: list[ForecastPeriod] = Field(default_factory=list)
    alerts: list[AlertSummary] = Field(default_factory=list)
    citations: list[CitationBundle] = Field(default_factory=list)


class ChartPoint(StrictModel):
    label: str
    value: float


class ChartSeries(StrictModel):
    label: str
    points: list[ChartPoint]
    color: str | None = None


class LoopFrame(StrictModel):
    label: str
    timestamp: datetime | None = None
    description: str | None = None


class ComparisonModel(StrictModel):
    sourceId: str
    modelLabel: str
    cycleTime: datetime | None = None
    validTime: datetime | None = None
    summary: str
    confidence: str | None = None


class SoundingLevel(StrictModel):
    pressureHpa: float
    temperatureC: float | None = None
    dewpointC: float | None = None
    windSpeedKt: float | None = None
    windDirectionDeg: float | None = None


class ArtifactRequest(StrictModel):
    artifactType: Literal[
        "meteogram",
        "research-report",
        "brief-report",
        "radar-loop",
        "satellite-loop",
        "model-comparison-panel",
        "hydrograph",
        "skewt",
        "rainfall-chart",
        "snowfall-chart",
    ]
    prompt: str = Field(min_length=1, max_length=4000)
    location: LocationContext | None = None
    locationQuery: str | None = None
    chartPoints: list[ChartPoint] = Field(default_factory=list)
    chartSeries: list[ChartSeries] = Field(default_factory=list)
    frames: list[LoopFrame] = Field(default_factory=list)
    comparisonModels: list[ComparisonModel] = Field(default_factory=list)
    soundingLevels: list[SoundingLevel] = Field(default_factory=list)
    thresholds: list[ChartPoint] = Field(default_factory=list)
    sections: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_location(self) -> "ArtifactRequest":
        if not self.location and not self.locationQuery:
            raise ValueError("location or locationQuery is required")

        return self

    def display_location(self) -> str:
        if self.locationQuery:
            return self.locationQuery

        if self.location:
            return self.location.display_name()

        return "Unknown location"


class ArtifactResponse(StrictModel):
    artifactId: str
    artifactType: str
    title: str
    href: str
    mimeType: str
    createdAt: datetime


class ErrorResponse(StrictModel):
    code: str
    message: str


class HealthResponse(StrictModel):
    ok: bool = True
    service: str = "raincheck-weather"
    artifactTypes: list[str] = Field(
        default_factory=lambda: [
            "meteogram",
            "research-report",
            "brief-report",
            "radar-loop",
            "satellite-loop",
            "model-comparison-panel",
            "hydrograph",
            "skewt",
            "rainfall-chart",
            "snowfall-chart",
        ]
    )
    implementedProducts: list[str] = Field(
        default_factory=lambda: [
            "nws-forecast",
            "nws-hourly-forecast",
            "nws-observation",
            "nws-alerts",
            "artifact-meteogram",
            "artifact-research-report",
            "artifact-brief-report",
            "artifact-radar-loop",
            "artifact-satellite-loop",
            "artifact-model-comparison-panel",
            "artifact-hydrograph",
            "artifact-skewt",
            "artifact-rainfall-chart",
            "artifact-snowfall-chart",
        ]
    )
