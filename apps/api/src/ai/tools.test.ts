import { describe, expect, it } from 'vitest'

import { buildServerTools } from './tools'

describe('buildServerTools', () => {
  it('exposes generate_weather_artifact when the request asks for a supported visual', () => {
    const tools = buildServerTools({} as any, {
      taskClass: 'research',
      intent: 'severe-weather',
      timeHorizonHours: 6,
      locationRequired: true,
      needsArtifact: true,
    })

    expect(tools.map((tool: any) => tool.name)).toContain(
      'generate_weather_artifact',
    )
  })

  it('keeps the artifact tool hidden for non-visual weather requests', () => {
    const tools = buildServerTools({} as any, {
      taskClass: 'research',
      intent: 'severe-weather',
      timeHorizonHours: 6,
      locationRequired: true,
      needsArtifact: false,
    })

    expect(tools.map((tool: any) => tool.name)).not.toContain(
      'generate_weather_artifact',
    )
  })
})
