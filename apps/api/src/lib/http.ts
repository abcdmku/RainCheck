import type { RainCheckEnv } from '@raincheck/config'

import { AppError } from './errors'

function buildInit(env: RainCheckEnv, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json, text/plain;q=0.9, */*;q=0.8')
  }
  if (!headers.has('user-agent')) {
    headers.set('user-agent', env.NWS_USER_AGENT)
  }

  return {
    ...init,
    headers,
  } satisfies RequestInit
}

export async function fetchJson<T>(
  env: RainCheckEnv,
  input: string | URL,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(input, buildInit(env, init))

  if (!response.ok) {
    throw new AppError(
      response.status,
      'upstream_request_failed',
      `Upstream request failed with ${response.status}`,
      {
        url: String(input),
        status: response.status,
      },
    )
  }

  return (await response.json()) as T
}

export async function fetchText(
  env: RainCheckEnv,
  input: string | URL,
  init: RequestInit = {},
) {
  const response = await fetch(input, buildInit(env, init))

  if (!response.ok) {
    throw new AppError(
      response.status,
      'upstream_request_failed',
      `Upstream request failed with ${response.status}`,
      {
        url: String(input),
        status: response.status,
      },
    )
  }

  return response.text()
}
