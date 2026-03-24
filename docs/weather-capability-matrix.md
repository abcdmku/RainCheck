# Weather Capability Matrix

This matrix is the current truth for the repo as of March 24, 2026.

## Runtime

| Capability | Current runtime path | Status | Free/public data | Extra credentials |
| --- | --- | --- | --- | --- |
| End-to-end chat app | Web -> Fastify API -> LLM provider | Implemented | No | Requires at least one model provider API key |
| U.S. current conditions | `apps/api` -> `api.weather.gov` | Implemented | Yes | `NWS_USER_AGENT` only |
| U.S. forecast | `apps/api` -> `api.weather.gov` | Implemented | Yes | `NWS_USER_AGENT` only |
| U.S. alerts | `apps/api` -> `api.weather.gov` | Implemented | Yes | `NWS_USER_AGENT` only |
| U.S. severe-weather context | `apps/api` -> NWS alerts + SPC outlook page | Limited | Yes | `NWS_USER_AGENT` only |
| Aviation METAR/TAF | `apps/api` -> Aviation Weather Center | Implemented | Yes | No API key |
| Geocoding | Literal lat/lon, U.S. Census, Open-Meteo fallback | Implemented | Yes | No API key |
| Meteogram artifact | Fastify -> Python weather service or local fallback | Implemented | Yes | No weather API key |
| Research report artifact | Fastify -> Python weather service or local fallback | Implemented | Yes | No weather API key |

## Planned / Scaffolded

| Capability family | Repo status | Notes |
| --- | --- | --- |
| WPC rainfall / excessive rainfall products | Scaffolded | Cataloged, not fetched in the runtime |
| NWPS hydrology / river forecasts | Scaffolded | No live NWPS fetcher wired into chat |
| NEXRAD radar data / loops | Scaffolded | Cataloged only |
| GOES satellite products / loops | Scaffolded | Cataloged only |
| MRMS analysis products | Scaffolded | Cataloged only |
| HRRR / GFS / GEFS model guidance | Scaffolded | Mentioned in source catalogs, not live in the MVP |
| ECMWF open-data comparison | Scaffolded | Env supports richer future access, runtime does not use it today |
| GeoNames fallback geocoder | Scaffolded | Env supports a future username-backed fallback, runtime does not use it today |
| NCEI climate products | Scaffolded | Token env exists, runtime does not use it today |

## Access Notes

| Provider / service | Access notes |
| --- | --- |
| NWS / weather.gov | Free public API. Requires a custom User-Agent header, not an API key. |
| U.S. Census Geocoder | Free public API. |
| Open-Meteo Geocoding API | Free for lightweight use. Commercial reserved resources use an API key. |
| Aviation Weather Center Data API | Free public API with request-rate guidance. |
| OpenAI API | Paid API key required for end-to-end app use. |
| Anthropic API | Paid usage credits / API key required for end-to-end app use. |
| Gemini API | API key required; free and paid tiers exist. |
| OpenRouter API | API key required; credit-based billing with a small free allowance. |
| GeoNames | Username required if this fallback is implemented later. |
| NCEI CDO | Token-based access if implemented later. |
| ECMWF Data Store / PAT path | PAT-backed access is for future richer integrations, not the current MVP. |
