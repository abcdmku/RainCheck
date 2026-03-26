import { describe, expect, it } from 'vitest'

import { buildWeatherFallbackText } from './weather-recovery'

describe('buildWeatherFallbackText', () => {
  it('preserves acronyms and keeps synthesized severe fallback text readable', () => {
    const text = buildWeatherFallbackText([
      {
        toolCallId: 'tool-1',
        toolName: 'synthesize_weather_conclusion',
        result: {
          bottomLine:
            'From Yorkville, plan around a late-afternoon into evening chase window and stay flexible inside the broader northern to central Illinois severe corridor.',
          confidence: {
            level: 'medium',
            reason:
              'SPC severe context supports the corridor, but exact storm initiation is not pinned down yet.',
          },
          mostLikelyScenario:
            'Storms become most chase-worthy late Thursday afternoon and evening if they stay discrete before clustering later.',
          keySignals: [
            'SPC keeps northern and central Illinois in the enhanced severe corridor.',
            'Short-range guidance still needs to tighten the exact initiation corridor.',
          ],
          conflicts: [
            'The first supercell corridor can still wobble if boundaries shift.',
          ],
          productCards: [],
        },
      },
    ])

    expect(text).toContain('Confidence is medium.')
    expect(text).not.toContain('sPC')
    expect(text).not.toContain('anchor the severe-weather call')
    expect(text).not.toContain('That call leans on')
  })
})
