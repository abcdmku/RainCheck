# Architecture

RainCheck is split into a few boring services and shared packages.

## Web

`apps/web` is the primary reference client. It uses TanStack Start, TanStack Router, TanStack Query, and TanStack AI. The web app renders the full-height chat shell, conversation list, settings, artifact viewers, and in-thread weather cards.

## API

`apps/api` is a Fastify server with:

- SQLite for local persistence
- Drizzle ORM for typed database access
- SSE chat streaming for TanStack AI
- provider routing and BYOK preference handling
- public weather source orchestration
- a thin client for the Python weather service

The API classifies the incoming request, chooses source families, fetches and normalizes data, calls the Python service when deterministic analysis or artifact generation is needed, and then synthesizes the answer.

## Weather service

`services/weather` is a FastAPI service focused on deterministic weather analysis and artifact generation. The Node backend should treat it like a typed dependency, not a magical sidecar.

## Shared packages

- `packages/contracts` holds zod schemas for conversations, settings, tool plans, source catalogs, artifacts, and normalized weather data.
- `packages/api-client` holds the fetch client reused by the web, desktop, and mobile apps.

## Runtime shape

In development the system uses:

- one root `.env`
- one SQLite file
- local filesystem artifact storage
- public weather APIs where possible

Production adapters can be added later without changing the core control flow.
