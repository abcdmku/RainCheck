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

  it('routes multi-model comparison prompts into the global guidance workflow', () => {
    const classification = classifyRequest(
      'Compare the GFS and ECMWF for Austin tomorrow morning',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'global-model',
      needsArtifact: false,
    })
    expect(classification.timeHorizonHours).toBe(48)
  })

  it('routes generic overnight model prompts into short-range guidance synthesis', () => {
    const classification = classifyRequest(
      'What do the models say about tonight in Oklahoma City?',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'short-range-model',
      needsArtifact: false,
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
      needsArtifact: false,
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

  it('keeps SPC shorthand in the severe-weather workflow and infers the 3 day window', () => {
    const classification = classifyRequest('3 day spc chicago')

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: true,
      needsArtifact: false,
    })
    expect(classification.timeHorizonHours).toBe(72)
  })

  it('routes broad model-driven storm hunts into weather analysis', () => {
    const classification = classifyRequest(
      'based off current models where are the best storms happening in the next 4 days',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'weather-analysis',
      locationRequired: false,
      needsArtifact: false,
    })
    expect(classification.timeHorizonHours).toBe(96)
  })

  it('routes typo-heavy broad severe prompts into severe-weather research', () => {
    const classification = classifyRequest(
      'where are the most severe strorms happening in the nextg 3 days',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: false,
      needsArtifact: false,
    })
    expect(classification.timeHorizonHours).toBe(72)
  })

  it('keeps HRRR tornado chase prompts in the severe-weather workflow', () => {
    const classification = classifyRequest(
      'in central IL where should i head and what time according to the HRRR model to see tornados',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: true,
      needsArtifact: false,
    })
    expect(classification.timeHorizonHours).toBe(6)
  })
})
