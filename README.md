# RainCheck

RainCheck is a chat-first AI weather application for `raincheck.chat`.

The repo is organized as a small pnpm monorepo:

- `apps/web` contains the primary TanStack Start chat experience.
- `apps/api` contains the Fastify backend, SQLite persistence, SSE chat streaming, and weather orchestration.
- `apps/mobile` contains the Expo shell.
- `apps/desktop` contains the Electron shell.
- `packages/contracts` contains shared zod schemas, source catalogs, and typed domain contracts.
- `packages/sdk` contains the shared client for the product API.
- `services/weather` contains the FastAPI weather-analysis service.

## Docker Compose

1. Copy `.env.example` to `.env` and provide at least one model provider key.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`.

The compose stack starts the primary chat workflow only: the web app, Node API, and Python weather service. SQLite data and generated artifacts are stored in the `raincheck-artifacts` Docker volume.
Only the UI entrypoint is published on the host. The API and weather services stay on the internal Docker network behind an internal reverse proxy.
If port `3000` is already in use, set `RAINCHECK_WEB_PORT` before starting Compose.

## Local setup

1. Install Node dependencies with `pnpm install`.
2. Install the Python weather service dependencies with `pnpm setup:weather` if you want to run the service locally.
3. Copy `.env.example` to `.env` and provide at least one model provider key.
4. Run `pnpm dev`.
5. Open `http://localhost:3000` and ask a weather question.

## Main commands

- `pnpm dev` starts the web app, Node API, and Python weather service.
- `pnpm dev:web`, `pnpm dev:api`, `pnpm dev:weather` run individual services.
- `pnpm dev:mobile` starts the Expo shell.
- `pnpm dev:desktop` starts the Electron shell.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` run workspace checks.
- `pnpm test` falls back to Docker for `services/weather` pytest when local Python is unavailable but Docker is installed.

## Product shape

RainCheck is intentionally chat-first:

- full-height conversation viewport
- collapsible sidebar
- minimal chrome
- bottom composer
- inline weather cards, artifacts, and citations

Research flows stay inside the thread. The app does not ship a dashboard homepage.

## Notes

- The backend works with one provider configured and falls back across OpenAI, Anthropic, Gemini, or OpenRouter when multiple are available.
- The live MVP currently uses public sources centered on NWS, U.S. Census geocoding, Open-Meteo geocoding fallback, and Aviation Weather Center products.
- Radar, satellite, hydrology, and model-guidance families remain scaffolded until their fetchers are wired into the runtime.
- Artifacts are stored on the local filesystem in development.

More detail lives in [docs/architecture.md](docs/architecture.md).
Current capability and access status lives in [docs/weather-capability-matrix.md](docs/weather-capability-matrix.md).
