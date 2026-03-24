# RainCheck Weather Service

FastAPI service for deterministic RainCheck weather analysis and artifact generation.

This service is intentionally narrow:

- the Node backend owns chat orchestration, auth, persistence, and provider routing
- the Python service owns deterministic weather fetch/normalize work and server-generated artifacts
- request and response shapes stay explicit and stable for backend-to-backend calls

## Implemented endpoints

- `GET /health`
- `GET /catalog`
- `POST /weather/current`
- `POST /weather/forecast`
- `POST /weather/alerts`
- `POST /weather/analysis`
- `POST /artifacts/meteogram`
- `POST /artifacts/research-report`
- `POST /artifacts/brief-report`
- `POST /artifacts/radar-loop`
- `POST /artifacts/satellite-loop`
- `POST /artifacts/model-comparison-panel`
- `POST /artifacts/hydrograph`
- `POST /artifacts/skewt`
- `POST /artifacts/rainfall-chart`
- `POST /artifacts/snowfall-chart`

## Node backend contract

The service supports this backend-to-backend contract:

1. Node resolves user input to a location and sends `latitude` / `longitude`
2. Python returns normalized NWS-focused weather data plus citations
3. Node decides how to present the response inside the chat thread

Today, the main chat runtime still fetches current conditions, forecast, alerts, aviation, and geocoding directly in `apps/api`. The Python service is currently used most heavily for artifact generation, service health, direct tests, and future expansion points.

Example request:

```json
{
  "location": {
    "latitude": 35.4676,
    "longitude": -97.5164,
    "name": "Oklahoma City, OK"
  },
  "prompt": "Summarize the next 24 hours",
  "includeForecast": true,
  "includeHourlyForecast": true,
  "includeAlerts": true,
  "forecastPeriods": 6
}
```

Response highlights:

- `summary`: short deterministic bullets ready for chat synthesis
- `current`, `forecast`, `alerts`: normalized weather payloads
- `citations`: source/product references with fetch time and valid time
- `normalizedProducts`: compact manifest of the product families used

## Catalog and extension points

`GET /catalog` returns:

- implemented NWS products used in the MVP
- the internal RainCheck artifact generator and its implemented artifact products
- planned source/product stubs for radar, satellite, MRMS, model guidance, and hydrology

The catalog is intentionally conservative: only the NWS weather endpoints and the server-generated artifact paths are considered implemented in this service today.

Heavy scientific packages remain optional. The service can run the current MVP without them and keeps clear extension points for later radar, satellite, and model artifact work.

## Local development

```bash
python -m pip install -e .[dev]
python -m uvicorn raincheck_weather.app:app --reload --app-dir src --host 127.0.0.1 --port 8000
```

## Environment

- `ARTIFACTS_DIR`: filesystem path for generated artifacts
- `WEATHER_ARTIFACT_BASE_PATH`: relative or absolute path exposed by the Node API for artifact downloads
- `NWS_USER_AGENT`: required for polite weather.gov access in shared environments
- `NWS_BASE_URL`: override for tests or internal proxies
- `WEATHER_HTTP_TIMEOUT_SECONDS`: upstream request timeout
