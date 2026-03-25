# RainCheck Team

## Roles

- `ui_designer`: owns chat shell layout, message presentation, and product-card polish.
- `app_engineer`: owns TanStack Start, Fastify API, shared TypeScript contracts, chat orchestration, and persistence.
- `weather_engineer`: owns the FastAPI weather service, deterministic analysis, product connectors, and Python tests.

## Working Agreement

- Keep the chat workflow primary.
- Use `fetch -> normalize -> synthesize -> answer` for weather questions.
- Hide comparison-table and model-comparison artifact paths.
- Prefer explicit contracts, small modules, and direct data flow.
- Let the app backend orchestrate; let the weather service provide deterministic analysis and artifacts.
