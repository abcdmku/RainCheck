# Weather Tools Issue Set

This document turns the March 24, 2026 weather-tools PRD into a repo-grounded backlog for RainCheck.

## Current repo anchors

- Fastify chat entrypoint: `apps/api/src/routes/chat.ts` -> `apps/api/src/ai/chat-service.ts`
- Current tool wiring: `apps/api/src/ai/tools.ts`
- Current request classification: `apps/api/src/ai/classify-request.ts`
- Current source ranking: `apps/api/src/weather/source-selection.ts`
- Current live weather fetchers: `apps/api/src/weather/geocode.ts`, `apps/api/src/weather/nws.ts`, `apps/api/src/weather/aviation.ts`
- Current artifact bridge: `apps/api/src/weather/service-client.ts`
- Artifact download route: `apps/api/src/routes/artifacts.ts`
- Shared tool definitions and schemas: `packages/contracts/src/tools.ts`, `packages/contracts/src/weather.ts`, `packages/contracts/src/catalog.ts`
- Python service entrypoint: `services/weather/src/raincheck_weather/app.py`
- Python service models and catalog: `services/weather/src/raincheck_weather/models.py`, `services/weather/src/raincheck_weather/catalog.py`
- Python artifact generation: `services/weather/src/raincheck_weather/artifacts.py`

## Current gaps versus the PRD

1. The chat runtime only exposes a small fixed tool set. "Lazy discovery" is currently a switch statement in `buildServerTools`, not a domain-aware registry.
2. Advanced weather prompts are mostly collapsed into `research-brief`. The schema knows about `hydrology`, `model-comparison`, and `radar-analysis`, but `classifyRequest()` does not emit those intents today.
3. Weather tool outputs do not share the PRD envelope. Current outputs are domain-specific zod objects like `currentConditionsSchema` and `forecastSummarySchema`.
4. The Fastify layer has chat logging middleware, but no weather fetch middleware for retries, cache policy, source tagging, fallback, or per-source observability.
5. The Python artifact contract only supports `meteogram` and `research-report`.
6. Current live weather families are limited to geocoding, NWS current/forecast/alerts, a lightweight SPC page scrape, and METAR/TAF.

## Foundation issues that should land before or with P0

### WX-00 Shared weather envelope and naming alignment

- Add a shared `weatherToolEnvelopeSchema` in `packages/contracts/src/weather.ts` for weather data tools with:
  `sourceId`, `sourceName`, `retrievedAt`, `validAt` or `validRange`, `location`, `units`, `confidence`, `summary`, `data`, `citations`, `artifacts`
- Mirror the same structure in `services/weather/src/raincheck_weather/models.py`
- Keep `resolve_location` as a special orchestration tool and do not force it into the weather-data envelope
- Align tool names with the PRD:
  `get_forecast_summary` -> `get_forecast`
  `get_aviation_summary` -> `get_aviation_weather`
  `generate_artifact` -> `generate_weather_artifact`
- Decide whether `get_severe_summary` becomes a compatibility shim or is replaced by `get_spc_severe_products`

### WX-01 Lazy tool registry and domain routing

- Replace the current `switch` in `apps/api/src/ai/tools.ts` with an always-on core tool set plus lazy weather family registration
- Expand `requestClassificationSchema` and `classifyRequest()` so the runtime can emit PRD domains directly:
  `severe`, `fire-weather`, `precipitation`, `winter-weather`, `medium-range`, `hydrology`, `radar`, `satellite`, `mrms`, `short-range-model`, `blend-analysis`, `global-model`, `aviation`, `tropical`, `marine`, `upper-air`, `historical-climate`, `storm-history`
- Keep `resolve_location`, `get_current_conditions`, `get_forecast`, and `get_alerts` always on
- Expose the long tail only after classification and location/time normalization

### WX-02 Weather fetch middleware, cache, and fallback

- Add a weather runtime helper in `apps/api/src/weather` for:
  retries
  TTL-based cache lookup
  structured logging
  source/product tagging
  fallback to the next valid public source
- Keep the TanStack chat middleware in `apps/api/src/ai/chat-service.ts`, but move weather-specific concerns out of `fetchJson()`
- Start with in-memory or SQLite-backed cache metadata only if it stays simple; do not add a registry-heavy abstraction layer

### WX-03 Artifact contract expansion

- Extend `packages/contracts/src/tools.ts` and `services/weather/src/raincheck_weather/models.py` so `generate_weather_artifact` accepts more than `meteogram` and `research-report`
- Target artifact types:
  `radar-loop`
  `satellite-loop`
  `model-comparison-panel`
  `hydrograph`
  `skewt`
  `rainfall-chart`
  `snowfall-chart`
  `brief-report`
- Preserve the current Node pattern in `apps/api/src/weather/service-client.ts` where Node calls `POST /artifacts/<artifactType>` and serves returned files from `GET /api/artifacts/:id`

## Tool map

All weather server tools execute through `POST /api/chat` today via `apps/api/src/routes/chat.ts`. Generated artifacts are served from `GET /api/artifacts/:id`.

| Tool | Priority | Current Fastify touchpoint | Current parser / schema anchor | Target cache key shape | Python artifact contract | Current status |
| --- | --- | --- | --- | --- | --- | --- |
| `resolve_location` | Core | `/api/chat` -> `buildServerTools()` -> `geocodeQuery()` | `normalizedLocationSchema`, `apps/api/src/weather/geocode.ts` | `wx:loc:v1:<normalized-query>` | None | Implemented |
| `get_current_conditions` | Core | `/api/chat` -> `buildServerTools()` -> `getCurrentConditions()` | `currentConditionsSchema`, `apps/api/src/weather/nws.ts` | `wx:current:v1:<lat>,<lon>` | None | Implemented |
| `get_forecast` | Core | `/api/chat` -> `buildServerTools()` -> `getForecast()` | `forecastSummarySchema`, `apps/api/src/weather/nws.ts` | `wx:forecast:v1:<lat>,<lon>:<horizon>` | `meteogram`, later `rainfall-chart` / `snowfall-chart` | Implemented under the current tool name `get_forecast_summary` |
| `get_alerts` | Core | `/api/chat` -> `buildServerTools()` -> `getAlerts()` | `alertSummarySchema`, `apps/api/src/weather/nws.ts` | `wx:alerts:v1:<lat>,<lon>` | None | Implemented |
| `get_spc_severe_products` | P0 | `/api/chat` lazy tool family `severe` | New `spcSevereProductsSchema`; start from `apps/api/src/weather/nws.ts:getSevereSummary()` and split into `apps/api/src/weather/spc.ts` | `wx:spc-severe:v1:<lat>,<lon>:<window>` | Optional `brief-report`; pair with `radar-loop` when storms are active | Partial scaffold only |
| `get_fire_weather_products` | P2 | `/api/chat` lazy tool family `fire-weather` | New `fireWeatherProductsSchema`; new `apps/api/src/weather/spc.ts` or `fire-weather.ts` | `wx:spc-fire:v1:<lat>,<lon>:<window>` | Optional `brief-report` | Missing |
| `get_wpc_qpf_ero` | P0 | `/api/chat` lazy tool family `precipitation` | New `wpcQpfEroSchema`; new `apps/api/src/weather/wpc.ts`; source catalog already has WPC scaffold | `wx:wpc-qpf-ero:v1:<lat>,<lon>:<window>` | `rainfall-chart`, later flood-focused brief artifact | Missing |
| `get_wpc_winter_weather` | P1 | `/api/chat` lazy tool family `winter-weather` | New `wpcWinterWeatherSchema`; new `apps/api/src/weather/wpc.ts` | `wx:wpc-winter:v1:<lat>,<lon>:<window>` | `snowfall-chart` | Missing |
| `get_wpc_medium_range_hazards` | P1 | `/api/chat` lazy tool family `medium-range` | New `wpcMediumRangeHazardsSchema`; new `apps/api/src/weather/wpc.ts` | `wx:wpc-medium:v1:<lat>,<lon>:<window>` | `brief-report` | Missing |
| `get_hydrology_nwps` | P0 | `/api/chat` lazy tool family `hydrology` | Replace or extend `getHydrologySummaryToolDef`; new `hydrologySummaryEnvelopeSchema`; new `apps/api/src/weather/hydrology.ts` | `wx:nwps:v1:<gauge-or-latlon>:<window>` | `hydrograph` | Tool def scaffold exists, no runtime wiring |
| `get_nexrad_radar` | P0 | `/api/chat` lazy tool family `radar` | New `nexradRadarSchema`; new `apps/api/src/weather/radar.ts`; catalog stubs exist in TS and Python | `wx:nexrad:v1:<site>:<product>:<window>` | `radar-loop` | Scaffolded in catalogs only |
| `get_goes_satellite` | P0 | `/api/chat` lazy tool family `satellite` | New `goesSatelliteSchema`; new `apps/api/src/weather/satellite.ts`; catalog stubs exist in TS and Python | `wx:goes:v1:<sector>:<product>:<window>:<lat>,<lon>` | `satellite-loop` | Scaffolded in catalogs only |
| `get_mrms_products` | P1 | `/api/chat` lazy tool family `mrms` | New `mrmsProductsSchema`; new `apps/api/src/weather/mrms.ts`; catalog stubs exist in TS and Python | `wx:mrms:v1:<product>:<window>:<bbox>` | `rainfall-chart`, hail/wind diagnostic panels | Scaffolded in catalogs only |
| `get_short_range_model_guidance` | P0 | `/api/chat` lazy tool family `short-range-model` | New `shortRangeGuidanceSchema`; new `apps/api/src/weather/models.ts`; source catalog already has HRRR/GFS/GEFS scaffolds | `wx:model-short:v1:<model>:<cycle>:<lat>,<lon>:<window>` | `model-comparison-panel`, `meteogram` | Missing |
| `get_blend_and_analysis_guidance` | P0 | `/api/chat` lazy tool family `blend-analysis` | New `blendAnalysisGuidanceSchema`; new `apps/api/src/weather/models.ts`; add NBM/RTMA/URMA catalog entries | `wx:blend-analysis:v1:<product>:<cycle>:<lat>,<lon>:<window>` | `model-comparison-panel` or surface-analysis panel | Missing |
| `get_global_model_guidance` | P0 | `/api/chat` lazy tool family `global-model` | New `globalModelGuidanceSchema`; new `apps/api/src/weather/models.ts`; extend existing GFS/GEFS/ECMWF catalog entries | `wx:model-global:v1:<model>:<cycle>:<lat>,<lon>:<window>` | `model-comparison-panel` | Partial catalog scaffold only |
| `compare_models` | P0 | `/api/chat` lazy meta-tool after two guidance tools complete | `modelComparisonSummarySchema` already exists; add tool def in `packages/contracts/src/tools.ts`; implementation can live in `apps/api/src/weather/models.ts` | `wx:model-compare:v1:<input-hash>` | `model-comparison-panel` | Schema exists, tool missing |
| `get_aviation_weather` | P0 | `/api/chat` -> expand current aviation tool path | Extend `aviationSummarySchema`; evolve `apps/api/src/weather/aviation.ts` beyond METAR/TAF into AIRMET replacement products, SIGMET, G-AIRMET, PIREP, CWA | `wx:aviation:v1:<station>:<product-set>:<window>` | Optional `brief-report`; no custom plot needed for first pass | Partially implemented |
| `get_tropical_weather` | P1 | `/api/chat` lazy tool family `tropical` | New `tropicalWeatherSchema`; new `apps/api/src/weather/tropical.ts`; add NHC catalog entries | `wx:tropical:v1:<basin>:<storm-or-area>:<advisory-set>` | `brief-report`, later track/cone panel | Missing |
| `get_marine_ocean_guidance` | P1 | `/api/chat` lazy tool family `marine` | New `marineOceanGuidanceSchema`; new `apps/api/src/weather/marine.ts`; add WAVEWATCH III and RTOFS catalog entries | `wx:marine:v1:<product>:<lat>,<lon>:<window>` | marine panel or `brief-report` | Missing |
| `get_upper_air_soundings` | P1 | `/api/chat` lazy tool family `upper-air` | New `upperAirSoundingsSchema`; new `apps/api/src/weather/upper-air.ts`; add NWS/SPC sounding catalog entries | `wx:upper-air:v1:<station>:<window>` | `skewt` | Missing |
| `get_historical_climate` | P1 | `/api/chat` lazy tool family `historical-climate` | New `historicalClimateSchema`; new `apps/api/src/weather/climate.ts`; add NCEI catalog entries | `wx:climate:v1:<dataset>:<station-or-latlon>:<window>` | `brief-report`, optional climate chart later | Missing |
| `get_storm_history` | P2 | `/api/chat` lazy tool family `storm-history` | New `stormHistorySchema`; new `apps/api/src/weather/climate.ts` or `storm-history.ts`; add Storm Events catalog entries | `wx:storm-history:v1:<area>:<window>:<event-types>` | `brief-report` | Missing |
| `generate_weather_artifact` | P0 foundation | `/api/chat` -> `generateArtifact()` -> Python `/artifacts/<artifactType>` -> `/api/artifacts/:id` | Extend `generateArtifactToolDef`, `ArtifactRequest`, `ArtifactResponse`, `apps/api/src/weather/service-client.ts`, `services/weather/src/raincheck_weather/artifacts.py` | `wx:artifact:v1:<artifact-type>:<input-hash>` | Expand current `meteogram` and `research-report` contract to all PRD artifact types | Partial implementation |

## P0 issue set

### WX-P0-01 Shared tool contract, lazy discovery, and routing foundation

- Scope:
  add the PRD weather envelope
  rename tools where needed
  add direct domain intents
  replace the hardcoded tool switch with always-on core tools plus lazy family exposure
  add weather fetch middleware for retries, logging, caching, and fallback
- Main files:
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/classify-request.ts`
  `apps/api/src/ai/tools.ts`
  `apps/api/src/ai/chat-service.ts`
  new helpers under `apps/api/src/weather/`
  `services/weather/src/raincheck_weather/models.py`
- Done when:
  every weather data tool can return the shared envelope
  classification emits domain-specific intents
  non-core tool families are hidden until selected
  weather fetches go through one retry/cache/fallback path

### WX-P0-02 `get_spc_severe_products`

- Scope:
  fetch SPC convective outlooks, watches, mesoscale discussions, and mesoanalysis summary data
  always pair with `get_alerts` for severe prompts
  expose only for severe-convective requests
- Main files:
  new `apps/api/src/weather/spc.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/tools.ts`
  `apps/api/src/ai/classify-request.ts`
- Cache key:
  `wx:spc-severe:v1:<lat>,<lon>:<window>`
- Artifact contract:
  optional `brief-report` now
  future pairing with `radar-loop` after `get_nexrad_radar`

### WX-P0-03 `get_wpc_qpf_ero`

- Scope:
  fetch WPC Day 1-7 QPF and ERO summaries for rainfall and flash-flood questions
  route flood-risk and "how much rain" prompts here before generic model tools
- Main files:
  new `apps/api/src/weather/wpc.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/tools.ts`
- Cache key:
  `wx:wpc-qpf-ero:v1:<lat>,<lon>:<window>`
- Artifact contract:
  `rainfall-chart`

### WX-P0-04 `get_hydrology_nwps`

- Scope:
  replace the unused hydrology scaffold with live NWPS gauge observations, river forecasts, flood stage metadata, and flood impacts
  route all river and flood-stage prompts here before general guidance
- Main files:
  new `apps/api/src/weather/hydrology.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/tools.ts`
  `apps/api/src/ai/classify-request.ts`
- Cache key:
  `wx:nwps:v1:<gauge-or-latlon>:<window>`
- Artifact contract:
  `hydrograph`

### WX-P0-05 `get_nexrad_radar`

- Scope:
  add site-level radar fetch, recent scan summaries, and loop-ready frame handles
  use for active storms and radar-structure questions
- Main files:
  new `apps/api/src/weather/radar.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `services/weather/src/raincheck_weather/models.py`
  `services/weather/src/raincheck_weather/artifacts.py`
- Cache key:
  `wx:nexrad:v1:<site>:<product>:<window>`
- Artifact contract:
  `radar-loop`

### WX-P0-06 `get_goes_satellite`

- Scope:
  add GOES ABI and GLM summary fetches for cloud tops, initiation, water vapor, smoke, fog, and lightning context
  support loop-ready handles for the Python service
- Main files:
  new `apps/api/src/weather/satellite.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `services/weather/src/raincheck_weather/models.py`
  `services/weather/src/raincheck_weather/artifacts.py`
- Cache key:
  `wx:goes:v1:<sector>:<product>:<window>:<lat>,<lon>`
- Artifact contract:
  `satellite-loop`

### WX-P0-07 `get_short_range_model_guidance`

- Scope:
  support HRRR, RAP, NAM/NAM Nest, and HREF for 0-48 hour timing/detail questions
  expose only when the user asks for timing, fog, snow bands, severe evolution, or uncertainty
- Main files:
  new `apps/api/src/weather/models.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/tools.ts`
- Cache key:
  `wx:model-short:v1:<model>:<cycle>:<lat>,<lon>:<window>`
- Artifact contract:
  `model-comparison-panel`, optional `meteogram`

### WX-P0-08 `get_blend_and_analysis_guidance`

- Scope:
  add NBM, RTMA, and URMA for calibrated near-term guidance and analysis-first "what is happening now" questions
  route current and very short-range timing questions to observations plus this tool before pure model guidance
- Main files:
  new `apps/api/src/weather/models.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
- Cache key:
  `wx:blend-analysis:v1:<product>:<cycle>:<lat>,<lon>:<window>`
- Artifact contract:
  surface-analysis or model comparison panel

### WX-P0-09 `get_global_model_guidance` and `compare_models`

- Scope:
  support GFS, GEFS, ECMWF IFS, and AIFS for days 2-10 questions
  require at least two model families before `compare_models` can execute
  include WPC medium-range hazards later when hazard framing matters
- Main files:
  new `apps/api/src/weather/models.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/tools.ts`
- Cache keys:
  `wx:model-global:v1:<model>:<cycle>:<lat>,<lon>:<window>`
  `wx:model-compare:v1:<input-hash>`
- Artifact contract:
  `model-comparison-panel`

### WX-P0-10 Expand `get_aviation_weather`

- Scope:
  keep METAR and TAF
  add PIREP, SIGMET, G-AIRMET, Center Weather Advisory, and machine-readable aviation hazard products where available
  route aviation prompts to this tool family before generic weather fetchers
- Main files:
  `apps/api/src/weather/aviation.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/classify-request.ts`
  `apps/api/src/ai/tools.ts`
- Cache key:
  `wx:aviation:v1:<station>:<product-set>:<window>`
- Artifact contract:
  optional `brief-report`

## P1 issue set

### WX-P1-01 `get_mrms_products`

- Scope:
  add MRMS QPE, precip-rate, composite radar, hail/wind diagnostics, and near-real-time analysis products
- Main files:
  new `apps/api/src/weather/mrms.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
- Cache key:
  `wx:mrms:v1:<product>:<window>:<bbox>`
- Artifact contract:
  `rainfall-chart` and diagnostic panels

### WX-P1-02 `get_wpc_winter_weather`

- Scope:
  add probabilistic snowfall and freezing-rain support for winter storm questions
- Main files:
  `apps/api/src/weather/wpc.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
- Cache key:
  `wx:wpc-winter:v1:<lat>,<lon>:<window>`
- Artifact contract:
  `snowfall-chart`

### WX-P1-03 `get_wpc_medium_range_hazards`

- Scope:
  add Day 3-7 hazards, 500-mb heights, surface systems, and key-message support for medium-range briefings
- Main files:
  `apps/api/src/weather/wpc.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
- Cache key:
  `wx:wpc-medium:v1:<lat>,<lon>:<window>`
- Artifact contract:
  `brief-report`

### WX-P1-04 `get_tropical_weather`

- Scope:
  add NHC outlooks and active advisories with timeline-aware public-facing summaries
  always route tropical prompts here before generic model summaries
- Main files:
  new `apps/api/src/weather/tropical.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/classify-request.ts`
  `apps/api/src/ai/tools.ts`
- Cache key:
  `wx:tropical:v1:<basin>:<storm-or-area>:<advisory-set>`
- Artifact contract:
  `brief-report`, later storm-track panel

### WX-P1-05 `get_marine_ocean_guidance`

- Scope:
  add WAVEWATCH III and RTOFS summaries for wave height, swell, surge, SST, and current questions
- Main files:
  new `apps/api/src/weather/marine.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
- Cache key:
  `wx:marine:v1:<product>:<lat>,<lon>:<window>`
- Artifact contract:
  marine panel or `brief-report`

### WX-P1-06 `get_upper_air_soundings`

- Scope:
  add observed sounding summaries and archive access for CAPE, shear, lapse rate, and teaching workflows
- Main files:
  new `apps/api/src/weather/upper-air.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `services/weather/src/raincheck_weather/artifacts.py`
- Cache key:
  `wx:upper-air:v1:<station>:<window>`
- Artifact contract:
  `skewt`

### WX-P1-07 `get_historical_climate`

- Scope:
  add NCEI CDO and Access Data Service support for historical weather, normals, and anomaly questions
  this issue should also add CPC catalog entries or a follow-on climate-outlook issue so long-range prompts do not fall back to short-range framing
- Main files:
  new `apps/api/src/weather/climate.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
  `apps/api/src/ai/classify-request.ts`
- Cache key:
  `wx:climate:v1:<dataset>:<station-or-latlon>:<window>`
- Artifact contract:
  `brief-report`

## P2 issue set

### WX-P2-01 `get_storm_history`

- Scope:
  add NCEI Storm Events support for historical severe-weather event research and post-event narratives
- Main files:
  new `apps/api/src/weather/storm-history.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
- Cache key:
  `wx:storm-history:v1:<area>:<window>:<event-types>`
- Artifact contract:
  `brief-report`

### WX-P2-02 `get_fire_weather_products`

- Scope:
  add SPC fire-weather outlooks and route wildfire weather-risk questions to them
- Main files:
  new `apps/api/src/weather/fire-weather.ts`
  `packages/contracts/src/tools.ts`
  `packages/contracts/src/weather.ts`
  `packages/contracts/src/catalog.ts`
- Cache key:
  `wx:spc-fire:v1:<lat>,<lon>:<window>`
- Artifact contract:
  optional `brief-report`

### WX-P2-03 GeoNames fallback

- Scope:
  wire the existing `GEONAMES_USERNAME` env scaffold into `apps/api/src/weather/geocode.ts`
  keep it behind Census and Open-Meteo
- Main files:
  `apps/api/src/weather/geocode.ts`
  `packages/contracts/src/catalog.ts`
- Cache key:
  `wx:loc:v1:<normalized-query>`
- Artifact contract:
  None

### WX-P2-04 Richer artifact generation

- Scope:
  move beyond chart stubs and report stubs
  support full radar loops, satellite loops, hydrographs, model comparison panels, Skew-T plots, and richer research exports from structured inputs
- Main files:
  `apps/api/src/weather/service-client.ts`
  `packages/contracts/src/tools.ts`
  `services/weather/src/raincheck_weather/models.py`
  `services/weather/src/raincheck_weather/artifacts.py`
  new Python helper modules as needed
- Cache key:
  `wx:artifact:v1:<artifact-type>:<input-hash>`
- Artifact contract:
  all expanded artifact types

## Suggested implementation sequence

1. Land `WX-00` through `WX-03` together so every later source tool shares one envelope, one routing model, and one artifact handshake.
2. Ship the PRD P0 live-data tools in this order:
   `get_spc_severe_products`
   `get_wpc_qpf_ero`
   `get_hydrology_nwps`
   `get_nexrad_radar`
   `get_goes_satellite`
   `get_short_range_model_guidance`
   `get_blend_and_analysis_guidance`
   `get_global_model_guidance`
   aviation expansion
3. Add `compare_models` in the same PR as the second live model family so the routing rule is enforceable.
4. After the fetchers land, expand the Python artifact types in the order radar -> satellite -> hydrograph -> model comparison -> Skew-T.

## Acceptance checks

- Every weather answer uses at least one relevant weather server tool.
- Severe, flood, aviation, tropical, marine, and climate prompts route to domain tools before generic forecast tools.
- Model-comparison answers run at least two guidance tools before synthesis.
- Weather fetches can retry and fall back without crashing the chat stream.
- Artifacts are generated from normalized tool payloads rather than raw GRIB, raw NetCDF, or raw radar volumes being passed to the model.
