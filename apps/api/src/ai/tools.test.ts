import { describe, expect, it } from 'vitest'

import { sanitizeToolsForGemini } from './gemini-tool-schemas'
import { buildServerTools } from './tools'

describe('buildServerTools', () => {
  it('exposes high-level derive tools for severe-weather research', () => {
    const tools = buildServerTools({} as any, {
      taskClass: 'research',
      intent: 'severe-weather',
      timeHorizonHours: 6,
      locationRequired: true,
      needsArtifact: true,
      chaseGuidanceLevel: 'general-target',
    })

    const toolNames = tools.map((tool: any) => tool.name)
    expect(toolNames).toContain('get_severe_context')
    expect(toolNames).toContain('derive_short_range_weather')
    expect(toolNames).toContain('derive_radar_nowcast')
    expect(toolNames).toContain('synthesize_weather_conclusion')
    expect(toolNames).toContain('generate_weather_artifact')
  })

  it('keeps the artifact tool hidden for non-visual weather requests', () => {
    const tools = buildServerTools({} as any, {
      taskClass: 'research',
      intent: 'severe-weather',
      timeHorizonHours: 6,
      locationRequired: true,
      needsArtifact: false,
      chaseGuidanceLevel: 'general-target',
    })

    expect(tools.map((tool: any) => tool.name)).not.toContain(
      'generate_weather_artifact',
    )
  })

  it('uses Gemini-safe input schemas for derive and synthesis tools', () => {
    const tools = sanitizeToolsForGemini(
      buildServerTools({} as any, {
        taskClass: 'research',
        intent: 'severe-weather',
        timeHorizonHours: 6,
        locationRequired: true,
        needsArtifact: false,
        chaseGuidanceLevel: 'general-target',
      }),
    )

    const targetTools = tools.filter((tool: any) =>
      [
        'derive_short_range_weather',
        'derive_radar_nowcast',
        'synthesize_weather_conclusion',
      ].includes(tool.name),
    )

    expect(targetTools.map((tool: any) => tool.name)).toEqual(
      expect.arrayContaining([
        'derive_short_range_weather',
        'derive_radar_nowcast',
        'synthesize_weather_conclusion',
      ]),
    )

    for (const tool of targetTools) {
      const inputSchemaText = JSON.stringify((tool as any).inputSchema)
      expect(inputSchemaText).not.toContain('"const"')
      expect(inputSchemaText).not.toContain('"exclusiveMinimum"')
      expect(inputSchemaText).not.toContain('"propertyNames"')
      expect(inputSchemaText).not.toContain('"oneOf"')
    }

    const synthesizeTool = targetTools.find(
      (tool: any) => tool.name === 'synthesize_weather_conclusion',
    )
    expect((synthesizeTool as any)?.inputSchema?.properties?.evidenceProducts)
      .toMatchObject({
        type: 'array',
      })
  })
})
