from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from .artifacts import generate_meteogram, generate_report
from .catalog import build_catalog
from .errors import ServiceError
from .models import (
    AlertsRequest,
    AlertsResponse,
    ArtifactRequest,
    ArtifactResponse,
    CatalogResponse,
    CurrentWeatherRequest,
    CurrentWeatherResponse,
    ErrorResponse,
    ForecastRequest,
    ForecastResponse,
    HealthResponse,
    WeatherAnalysisRequest,
    WeatherAnalysisResponse,
)
from .nws import NwsService
from .settings import Settings, load_settings

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


@app.post("/artifacts/meteogram", response_model=ArtifactResponse)
async def artifact_meteogram(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_meteogram(settings, payload)


@app.post("/artifacts/research-report", response_model=ArtifactResponse)
async def artifact_report(
    payload: ArtifactRequest,
    settings: Settings = Depends(get_settings),
) -> ArtifactResponse:
    return generate_report(settings, payload)
