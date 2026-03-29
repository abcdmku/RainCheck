from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class LocationContext(StrictModel):
    query: str | None = None
    name: str | None = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    region: str | None = None
    country: str | None = None
    timezone: str | None = None
    resolvedBy: str | None = None
    label: str | None = None

    def display_name(self) -> str:
        if self.label:
            return self.label
        if self.name:
            return self.name
        if self.query:
            return self.query
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


class CitationBundle(StrictModel):
    id: str
    label: str
    sourceId: str
    productId: str
    kind: EvidenceKind = "page"
    url: str | None = None
    contextUrl: str | None = None
    displayUrl: str | None = None
    issuedAt: datetime | None = None
    validAt: datetime | None = None
    note: str | None = None
    official: bool | None = None
    fetchedAt: datetime | None = None
    validRange: TimeRange | None = None


class WeatherCitation(CitationBundle):
    pass


class ArtifactHandle(StrictModel):
    artifactId: str
    type: str
    title: str
    href: str
    mimeType: str


class RequestedArtifact(StrictModel):
    type: Literal[
        "meteogram",
        "research-report",
        "radar-loop",
        "satellite-loop",
        "hydrograph",
        "skewt",
        "rainfall-chart",
        "snowfall-chart",
        "brief-report",
        "single-model-panel",
        "hodograph",
        "time-height-chart",
    ]
    required: bool = False
    maxFrames: int | None = Field(default=None, ge=1, le=36)


class WeatherRegionPoint(StrictModel):
    type: Literal["point"] = "point"
    location: LocationContext
    radiusKm: float = Field(default=80.0, gt=0.0, le=800.0)


class WeatherRegionBBox(StrictModel):
    type: Literal["bbox"] = "bbox"
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)
    label: str | None = None


WeatherRegion = WeatherRegionPoint | WeatherRegionBBox


class WeatherTimeWindow(StrictModel):
    start: datetime
    end: datetime
    referenceTime: datetime | None = None
    recentHours: int | None = Field(default=None, ge=0, le=72)

    @model_validator(mode="after")
    def validate_range(self) -> "WeatherTimeWindow":
        if self.start > self.end:
            raise ValueError("weather time windows must start before they end")
        return self


ChaseGuidanceLevel = Literal[
    "analysis-only",
    "general-target",
    "exact-target",
    "full-route",
]

TimeDisplay = Literal[
    "user-local",
    "dual",
    "target-local",
]

AnswerTone = Literal[
    "casual",
    "professional",
]

AnswerMode = Literal["single", "compare", "rank"]

CandidateMode = Literal["named", "discovered", "mixed"]

RankingObjective = Literal[
    "severe-favorability",
    "beach-day",
    "pleasant-weather",
]

EvidenceKind = Literal[
    "api",
    "page",
    "image",
    "dataset",
    "artifact",
    "derived",
]


class ResolvedWeatherRequest(StrictModel):
    userQuestion: str = Field(min_length=1, max_length=4000)
    workflow: str = Field(min_length=1)
    region: WeatherRegion
    timeWindow: WeatherTimeWindow
    chaseGuidanceLevel: ChaseGuidanceLevel = "analysis-only"
    focus: str | None = None
    variables: list[str] = Field(default_factory=list)
    requestedArtifacts: list[RequestedArtifact] = Field(default_factory=list)
    includeOfficialContext: bool = True


class EvidenceGeometryPoint(StrictModel):
    type: Literal["point"] = "point"
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    label: str | None = None


class EvidenceGeometryBBox(StrictModel):
    type: Literal["bbox"] = "bbox"
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)
    label: str | None = None


EvidenceGeometry = EvidenceGeometryPoint | EvidenceGeometryBBox


class EvidenceProvenance(StrictModel):
    sourceId: str
    productId: str
    label: str
    kind: EvidenceKind = "page"
    url: str | None = None
    contextUrl: str | None = None
    displayUrl: str | None = None
    retrievedAt: datetime
    issuedAt: datetime | None = None
    validAt: datetime | None = None
    validRange: TimeRange | None = None
    notes: list[str] = Field(default_factory=list)


class ProductCard(StrictModel):
    id: str
    title: str
    sourceId: str
    sourceName: str
    summary: str
    url: str | None = None
    contextUrl: str | None = None
    imageUrl: str | None = None
    imageAlt: str | None = None
    artifactId: str | None = None
    href: str | None = None
    mimeType: str | None = None
    relevance: Literal["primary", "supporting"] = "supporting"
    validAt: datetime | None = None
    validRange: TimeRange | None = None


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


class WeatherEnvelope(StrictModel):
    sourceId: str
    sourceName: str
    retrievedAt: datetime
    validAt: datetime | None = None
    validRange: TimeRange | None = None
    location: LocationContext | None = None
    units: dict[str, str] = Field(default_factory=dict)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    summary: str
    normalizedForecast: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    citations: list[WeatherCitation] = Field(default_factory=list)
    artifacts: list[ArtifactHandle] = Field(default_factory=list)
    thumbnailUrl: str | None = None
    imageAlt: str | None = None
    previewArtifactId: str | None = None
    fullArtifactId: str | None = None
    severity: str | None = None


class EvidenceProduct(StrictModel):
    id: str
    sourceFamily: str
    sourceName: str
    cycleTime: datetime | None = None
    validTime: datetime
    geometry: EvidenceGeometry
    fieldName: str
    fieldType: Literal[
        "raw_field",
        "derived_diagnostic",
        "probability",
        "official_product",
        "observation",
    ]
    level: str | None = None
    units: str
    spatialResolution: str | None = None
    summary: str
    summaryStats: dict[str, Any] = Field(default_factory=dict)
    signalScore: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    provenance: list[EvidenceProvenance] = Field(default_factory=list)
    artifactHandles: list[ArtifactHandle] = Field(default_factory=list)


class DerivationBundle(StrictModel):
    workflow: str
    region: WeatherRegion
    analysisWindow: WeatherTimeWindow
    evidenceProducts: list[EvidenceProduct] = Field(default_factory=list)
    agreementSummary: str
    keyConflicts: list[str] = Field(default_factory=list)
    recommendedCards: list[ProductCard] = Field(default_factory=list)
    recommendedArtifacts: list[ArtifactHandle] = Field(default_factory=list)
    sourcesUsed: list[str] = Field(default_factory=list)
    sourcesMissing: list[str] = Field(default_factory=list)


class DeriveShortRangeRequest(ResolvedWeatherRequest):
    domain: Literal[
        "severe",
        "convection",
        "storm-mode",
        "snow",
        "ice",
        "low-clouds",
        "fog",
        "temperature-gradient",
    ]


class DeriveGlobalRequest(ResolvedWeatherRequest):
    domain: Literal[
        "pattern",
        "severe-setup",
        "winter",
        "heavy-rain",
        "temperature-anomaly",
    ]


class DeriveRadarNowcastRequest(ResolvedWeatherRequest):
    domain: Literal[
        "storm-objects",
        "rotation",
        "hail",
        "wind",
        "training-rain",
        "precipitation",
    ]


class DeriveSatelliteRequest(ResolvedWeatherRequest):
    domain: Literal[
        "cloud-top",
        "convective-initiation",
        "moisture-plume",
        "low-clouds",
        "fog",
        "lightning",
    ]


class DeriveHydrologyRequest(ResolvedWeatherRequest):
    domain: Literal[
        "river-flood",
        "flash-flood",
        "peak-flow",
        "hydro-timing",
        "winter-hydrology",
    ]


class WeatherConfidence(StrictModel):
    level: Literal["low", "medium", "high"]
    reason: str


class ChaseTarget(StrictModel):
    query: str
    label: str
    location: LocationContext
    regionLabel: str | None = None
    startLabel: str | None = None
    stopLabel: str | None = None
    travelHours: float | None = Field(default=None, ge=0.0, le=24.0)
    corridorHours: float | None = Field(default=None, ge=0.0, le=12.0)
    withinNearbyRadius: bool | None = None
    supportScore: float | None = Field(default=None, ge=0.0, le=1.0)


class NightfallCutoff(StrictModel):
    event: Literal["civil-dusk", "sunset"]
    occursAt: datetime


class ComparisonCandidateInput(StrictModel):
    query: str | None = None
    label: str | None = None
    location: LocationContext | None = None
    source: Literal[
        "user",
        "follow-up-context",
        "beach-discovery",
        "severe-discovery",
    ] = "user"
    reason: str | None = None


class ComparisonCandidate(StrictModel):
    query: str | None = None
    label: str
    location: LocationContext
    source: Literal[
        "user",
        "follow-up-context",
        "beach-discovery",
        "severe-discovery",
    ] = "user"
    reason: str | None = None


class ComparisonDiscoveryScope(StrictModel):
    category: Literal["beach", "severe-weather"]
    locationQuery: str | None = None
    location: LocationContext | None = None
    radiusKm: int = Field(default=180, ge=1, le=500)


class ComparisonCandidateAnalysis(StrictModel):
    candidate: ComparisonCandidate
    currentConditions: WeatherEnvelope | None = None
    forecast: WeatherEnvelope | None = None
    alerts: WeatherEnvelope | None = None
    severeContext: WeatherEnvelope | None = None
    marineContext: WeatherEnvelope | None = None
    supportingBundles: list[DerivationBundle] = Field(default_factory=list)


class ComparedCandidate(StrictModel):
    candidate: ComparisonCandidate
    rank: int = Field(ge=1)
    score: float = Field(ge=0.0, le=1.0)
    confidence: WeatherConfidence
    summary: str
    why: str
    supportingSignals: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    recommendedCards: list[ProductCard] = Field(default_factory=list)


class ComparisonContext(StrictModel):
    workflow: str
    answerMode: AnswerMode
    candidateMode: CandidateMode
    rankLimit: int = Field(ge=1, le=12)
    rankingObjective: RankingObjective
    originLocation: LocationContext | None = None
    discoveryScope: ComparisonDiscoveryScope | None = None
    candidates: list[ComparisonCandidate] = Field(default_factory=list)


class CompareWeatherToolRequest(StrictModel):
    userQuestion: str = Field(min_length=1, max_length=4000)
    workflow: str = Field(min_length=1)
    answerMode: AnswerMode
    candidateMode: CandidateMode
    rankLimit: int = Field(default=1, ge=1, le=12)
    rankingObjective: RankingObjective
    originLocation: LocationContext | None = None
    displayTimezone: str | None = None
    answerTone: AnswerTone = "casual"
    timeDisplay: TimeDisplay = "user-local"
    discoveryScope: ComparisonDiscoveryScope | None = None
    candidates: list[ComparisonCandidateInput] = Field(default_factory=list)


class CompareWeatherRequest(StrictModel):
    userQuestion: str = Field(min_length=1, max_length=4000)
    workflow: str = Field(min_length=1)
    answerMode: AnswerMode
    candidateMode: CandidateMode
    rankLimit: int = Field(default=1, ge=1, le=12)
    rankingObjective: RankingObjective
    originLocation: LocationContext | None = None
    displayTimezone: str | None = None
    answerTone: AnswerTone = "casual"
    timeDisplay: TimeDisplay = "user-local"
    discoveryScope: ComparisonDiscoveryScope | None = None
    candidates: list[ComparisonCandidateAnalysis] = Field(min_length=1, max_length=12)


class CompareWeatherBundle(StrictModel):
    answerMode: AnswerMode
    rankingObjective: RankingObjective
    rankLimit: int = Field(ge=1, le=12)
    bottomLine: str
    confidence: WeatherConfidence
    whyRainCheckThinksThat: str
    sharedUncertainty: str | None = None
    winner: ComparedCandidate | None = None
    rankedCandidates: list[ComparedCandidate] = Field(default_factory=list)
    recommendedCards: list[ProductCard] = Field(default_factory=list)
    citations: list[CitationBundle] = Field(default_factory=list)
    comparisonContext: ComparisonContext | None = None


class SynthesisBundle(StrictModel):
    bottomLine: str
    mostLikelyScenario: str
    alternateScenarios: list[str] = Field(default_factory=list)
    confidence: WeatherConfidence
    agreementSummary: str
    keySupportingSignals: list[str] = Field(default_factory=list)
    keyConflicts: list[str] = Field(default_factory=list)
    bustRisks: list[str] = Field(default_factory=list)
    recommendedCards: list[ProductCard] = Field(default_factory=list)
    recommendedArtifacts: list[ArtifactHandle] = Field(default_factory=list)
    citations: list[CitationBundle] = Field(default_factory=list)
    evidenceProducts: list[EvidenceProduct] = Field(default_factory=list)


class SynthesizeRequest(StrictModel):
    userQuestion: str = Field(min_length=1, max_length=4000)
    workflow: str = Field(min_length=1)
    region: WeatherRegion
    timeWindow: WeatherTimeWindow
    chaseGuidanceLevel: ChaseGuidanceLevel = "analysis-only"
    originLocation: LocationContext | None = None
    displayTimezone: str | None = None
    answerTone: AnswerTone = "casual"
    timeDisplay: TimeDisplay = "user-local"
    selectedTarget: ChaseTarget | None = None
    nightfall: NightfallCutoff | None = None
    evidenceProducts: list[EvidenceProduct] = Field(default_factory=list)
    supportingBundles: list[DerivationBundle] = Field(default_factory=list)


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
    imageUrl: str | None = None


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
        "hydrograph",
        "skewt",
        "rainfall-chart",
        "snowfall-chart",
        "single-model-panel",
        "hodograph",
        "time-height-chart",
    ]
    prompt: str = Field(min_length=1, max_length=4000)
    location: LocationContext | None = None
    locationQuery: str | None = None
    chartPoints: list[ChartPoint] = Field(default_factory=list)
    chartSeries: list[ChartSeries] = Field(default_factory=list)
    frames: list[LoopFrame] = Field(default_factory=list)
    soundingLevels: list[SoundingLevel] = Field(default_factory=list)
    thresholds: list[ChartPoint] = Field(default_factory=list)
    sections: list[str] = Field(default_factory=list)
    evidenceProducts: list[EvidenceProduct] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_request(self) -> "ArtifactRequest":
        if not self.location and not self.locationQuery:
            raise ValueError("location or locationQuery is required")

        match self.artifactType:
            case "meteogram" | "rainfall-chart" | "snowfall-chart":
                if not self.chartPoints and not self.chartSeries:
                    raise ValueError(
                        f"{self.artifactType} requires chartPoints or chartSeries"
                    )
            case "research-report" | "brief-report" | "single-model-panel":
                if not self.sections and not self.evidenceProducts:
                    raise ValueError(
                        f"{self.artifactType} requires sections or evidenceProducts"
                    )
            case "radar-loop" | "satellite-loop":
                if not self.frames:
                    raise ValueError(f"{self.artifactType} requires frames")
            case "hydrograph":
                if not self.chartPoints and not self.chartSeries:
                    raise ValueError("hydrograph requires chartPoints or chartSeries")
            case "skewt":
                if not self.soundingLevels:
                    raise ValueError("skewt requires soundingLevels")
            case "hodograph" | "time-height-chart":
                if not self.chartSeries and not self.soundingLevels:
                    raise ValueError(
                        f"{self.artifactType} requires chartSeries or soundingLevels"
                    )

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
            "hydrograph",
            "skewt",
            "rainfall-chart",
            "snowfall-chart",
            "single-model-panel",
            "hodograph",
            "time-height-chart",
        ]
    )
    implementedProducts: list[str] = Field(
        default_factory=lambda: [
            "nws-forecast",
            "nws-hourly-forecast",
            "nws-observation",
            "nws-alerts",
            "derive-short-range",
            "derive-global",
            "derive-radar-nowcast",
            "derive-satellite",
            "derive-hydrology",
            "synthesize",
            "artifact-meteogram",
            "artifact-research-report",
            "artifact-brief-report",
            "artifact-radar-loop",
            "artifact-satellite-loop",
            "artifact-hydrograph",
            "artifact-skewt",
            "artifact-rainfall-chart",
            "artifact-snowfall-chart",
            "artifact-single-model-panel",
            "artifact-hodograph",
            "artifact-time-height-chart",
        ]
    )
