from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from .artifacts import generate_weather_artifact
from .catalog import build_catalog
from .comparison import compare_weather
from .derivations import (
    derive_global,
    derive_hydrology,
    derive_radar_nowcast,
    derive_satellite,
    derive_short_range,
)
from .errors import ServiceError
from .models import (
    AlertsRequest,
    AlertsResponse,
    ArtifactRequest,
    ArtifactResponse,
    CatalogResponse,
    CompareWeatherBundle,
    CompareWeatherRequest,
    CurrentWeatherRequest,
    CurrentWeatherResponse,
    DerivationBundle,
    DeriveGlobalRequest,
    DeriveHydrologyRequest,
    DeriveRadarNowcastRequest,
    DeriveSatelliteRequest,
    DeriveShortRangeRequest,
    ErrorResponse,
    ForecastRequest,
    ForecastResponse,
    HealthResponse,
    SynthesizeRequest,
    SynthesisBundle,
    WeatherAnalysisRequest,
    WeatherAnalysisResponse,
)
from .nws import NwsService
from .settings import Settings, load_settings
from .synthesis import synthesize_weather

app = FastAPI(title="RainCheck Weather Service", version="0.2.0")


def get_settings() -> Settings:
    return load_settings()


def get_nws_service(settings: Settings = Depends(get_settings)) -> NwsService:
    return NwsService(settings)


@app.exception_handler(ServiceError)
async def service_error_handler(
    _: Request,
    exc: ServiceError,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(code=exc.code, message=exc.message).model_dump(),
    )


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.get("/catalog", response_model=CatalogResponse)
async def catalog() -> CatalogResponse:
    return build_catalog()


@app.post("/weather/current", response_model=CurrentWeatherResponse)
async def weather_current(
    payload: CurrentWeatherRequest,
    service: NwsService = Depends(get_nws_service),
) -> CurrentWeatherResponse:
    return await service.get_current_conditions(payload)


@app.post("/weather/forecast", response_model=ForecastResponse)
async def weather_forecast(
    payload: ForecastRequest,
    service: NwsService = Depends(get_nws_service),
) -> ForecastResponse:
    return await service.get_forecast(payload)


@app.post("/weather/alerts", response_model=AlertsResponse)
async def weather_alerts(
    payload: AlertsRequest,
    service: NwsService = Depends(get_nws_service),
) -> AlertsResponse:
    return await service.get_alerts(payload)


@app.post("/weather/analysis", response_model=WeatherAnalysisResponse)
async def weather_analysis(
    payload: WeatherAnalysisRequest,
    service: NwsService = Depends(get_nws_service),
) -> WeatherAnalysisResponse:
    return await service.analyze(payload)


@app.post(
    "/derive/short-range",
    response_model=DerivationBundle,
    response_model_exclude_none=True,
)
async def derive_short_range_endpoint(
    payload: DeriveShortRangeRequest,
    settings: Settings = Depends(get_settings),
) -> DerivationBundle:
    return derive_short_range(settings, payload)


@app.post(
    "/derive/global",
    response_model=DerivationBundle,
    response_model_exclude_none=True,
)
async def derive_global_endpoint(
    payload: DeriveGlobalRequest,
    settings: Settings = Depends(get_settings),
) -> DerivationBundle:
    return derive_global(settings, payload)


@app.post(
    "/derive/radar-nowcast",
    response_model=DerivationBundle,
    response_model_exclude_none=True,
)
async def derive_radar_nowcast_endpoint(
    payload: DeriveRadarNowcastRequest,
    settings: Settings = Depends(get_settings),
) -> DerivationBundle:
    return derive_radar_nowcast(settings, payload)


@app.post(
    "/derive/satellite",
    response_model=DerivationBundle,
    response_model_exclude_none=True,
)
async def derive_satellite_endpoint(
    payload: DeriveSatelliteRequest,
    settings: Settings = Depends(get_settings),
) -> DerivationBundle:
    return derive_satellite(settings, payload)


@app.post(
    "/derive/hydrology",
    response_model=DerivationBundle,
    response_model_exclude_none=True,
)
async def derive_hydrology_endpoint(
    payload: DeriveHydrologyRequest,
    settings: Settings = Depends(get_settings),
) -> DerivationBundle:
    return derive_hydrology(settings, payload)


@app.post(
    "/synthesize",
    response_model=SynthesisBundle,
    response_model_exclude_none=True,
)
async def synthesize_endpoint(
    payload: SynthesizeRequest,
    settings: Settings = Depends(get_settings),
) -> SynthesisBundle:
    return synthesize_weather(settings, payload)


@app.post(
    "/compare",
    response_model=CompareWeatherBundle,
    response_model_exclude_none=True,
)
async def compare_endpoint(
    payload: CompareWeatherRequest,
) -> CompareWeatherBundle:
    return compare_weather(payload)


@app.post("/artifacts/meteogram", response_model=ArtifactResponse)
async def artifact_meteogram(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/research-report", response_model=ArtifactResponse)
async def artifact_report(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/brief-report", response_model=ArtifactResponse)
async def artifact_brief_report(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/radar-loop", response_model=ArtifactResponse)
async def artifact_radar_loop(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/satellite-loop", response_model=ArtifactResponse)
async def artifact_satellite_loop(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/single-model-panel", response_model=ArtifactResponse)
async def artifact_single_model_panel(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/hydrograph", response_model=ArtifactResponse)
async def artifact_hydrograph(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/skewt", response_model=ArtifactResponse)
async def artifact_skewt(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/hodograph", response_model=ArtifactResponse)
async def artifact_hodograph(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/time-height-chart", response_model=ArtifactResponse)
async def artifact_time_height_chart(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/rainfall-chart", response_model=ArtifactResponse)
async def artifact_rainfall_chart(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)


@app.post("/artifacts/snowfall-chart", response_model=ArtifactResponse)
async def artifact_snowfall_chart(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_weather_artifact(settings, payload)
