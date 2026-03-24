FROM node:24-bookworm-slim AS node-workspace

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN pnpm install --frozen-lockfile --filter @raincheck/api... --filter @raincheck/web...

COPY . .

FROM node-workspace AS web

WORKDIR /workspace/apps/web

EXPOSE 3000

CMD ["pnpm", "exec", "vite", "dev", "--host", "0.0.0.0", "--port", "3000"]

FROM node-workspace AS api

WORKDIR /workspace/apps/api

EXPOSE 3001

CMD ["pnpm", "exec", "tsx", "src/server.ts"]

FROM python:3.12-slim AS weather

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /workspace/services/weather

COPY services/weather/README.md services/weather/pyproject.toml ./
COPY services/weather/src ./src

RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "raincheck_weather.app:app", "--host", "0.0.0.0", "--port", "8000"]
