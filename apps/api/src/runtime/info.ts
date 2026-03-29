import { randomUUID } from 'node:crypto'
import type { RainCheckEnv } from '@raincheck/config'
import type { RuntimeInfo } from '@raincheck/contracts'
import type { StreamChunk } from '@tanstack/ai'

export type RainCheckRuntimeInfo = RuntimeInfo

export function createRuntimeInfo(env: RainCheckEnv): RainCheckRuntimeInfo {
  return {
    runtimeId: `api-${process.pid}-${randomUUID().slice(0, 8)}`,
    startedAt: new Date().toISOString(),
    processId: process.pid,
    environment: env.NODE_ENV,
    apiBaseUrl: env.API_BASE_URL,
    weatherServiceUrl: env.WEATHER_SERVICE_URL,
  }
}

export function runtimeHeaders(info: RainCheckRuntimeInfo) {
  return {
    'x-raincheck-runtime-id': info.runtimeId,
    'x-raincheck-runtime-started-at': info.startedAt,
    'x-raincheck-runtime-environment': info.environment,
    'x-raincheck-weather-service-url': info.weatherServiceUrl,
  } as const
}

export async function* withRuntimeInfoEvent(
  stream: AsyncIterable<StreamChunk>,
  info: RainCheckRuntimeInfo,
): AsyncIterable<StreamChunk> {
  yield {
    type: 'CUSTOM',
    name: 'runtime-info',
    value: info,
    model: 'raincheck-runtime',
    timestamp: Date.now(),
  } satisfies StreamChunk

  for await (const chunk of stream) {
    yield chunk
  }
}
