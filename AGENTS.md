# RainCheck Agents

RainCheck keeps agent usage deliberately small and concrete.

## Allowed subagents

- `ui_designer`: owns chat shell layout, message UI polish, and visual cleanup.
- `app_engineer`: owns the TanStack Start web app, Fastify API, shared TypeScript contracts, Electron shell, Expo shell, and persistence.
- `weather_engineer`: owns the FastAPI weather-analysis service, weather connectors, artifact generation, and Python tests.

## Boundaries

- The Node backend owns product orchestration, persistence, routing, settings, and AI provider selection.
- The Python service owns deterministic weather analysis and artifact/report generation.
- Shared contracts must stay explicit and readable. Prefer plain modules over registries or metaprogramming.

## Working style

- Keep modules small.
- Prefer switch statements and straightforward data flows over abstraction layers.
- Hide incomplete features rather than surfacing broken UI.
- Keep the chat workflow primary on every platform.
