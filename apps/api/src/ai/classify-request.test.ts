import { describe, expect, it } from 'vitest'

import { classifyRequest } from './classify-request'

describe('classifyRequest', () => {
  it('routes radar loop prompts into radar analysis', () => {
    const classification = classifyRequest(
      'Need a radar loop and storm setup briefing for Chicago tonight',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'radar-analysis',
      needsArtifact: true,
    })
  })

  it('routes model comparison prompts directly into model comparison', () => {
    const classification = classifyRequest(
      'Compare the GFS and ECMWF for Austin tomorrow morning',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'model-comparison',
      needsArtifact: true,
    })
    expect(classification.timeHorizonHours).toBe(48)
  })

  it('routes hydrology prompts into hydrology', () => {
    const classification = classifyRequest(
      'Give me a river and flood analysis for Tulsa this week',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'hydrology',
      needsArtifact: true,
    })
    expect(classification.timeHorizonHours).toBe(240)
  })

  it('routes aviation hazard prompts into aviation', () => {
    const classification = classifyRequest(
      'Any SIGMETs or G-AIRMET issues for KORD tonight?',
    )

    expect(classification).toMatchObject({
      taskClass: 'chat',
      intent: 'aviation',
    })
  })

  it('routes tropical prompts into tropical weather', () => {
    const classification = classifyRequest(
      'What does the latest NHC outlook say about tropical development near Florida?',
    )

    expect(classification).toMatchObject({
      intent: 'tropical',
    })
  })
})
