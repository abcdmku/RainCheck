import { describe, expect, it } from 'vitest'

import {
  classifyConversationRequest,
  classifyRequest,
} from './classify-request'

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

  it('treats broad good-storm week questions as severe-weather research even with a week typo', () => {
    const classification = classifyRequest('any good storms this weekl?')

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: false,
      chaseGuidanceLevel: 'analysis-only',
    })
    expect(classification.timeHorizonHours).toBe(240)
  })

  it('treats broad chase locator questions as severe-weather research without forcing the current city as the target area', () => {
    const classification = classifyRequest(
      'where is the best spot to start chasing the storms today and what time should i get there',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: false,
      chaseGuidanceLevel: 'general-target',
    })
    expect(classification.timeHorizonHours).toBe(12)
  })

  it('treats best-storm-to-spot prompts as broad severe-weather questions', () => {
    const classification = classifyRequest('best storm to spot currently?')

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: false,
      chaseGuidanceLevel: 'analysis-only',
    })
    expect(classification.timeHorizonHours).toBe(6)
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
      chaseGuidanceLevel: 'general-target',
    })
    expect(classification.timeHorizonHours).toBe(6)
  })

  it('keeps broader severe setup prompts at analysis-only guidance', () => {
    const classification = classifyRequest(
      'What is the severe setup near Yorkville tonight?',
    )

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      chaseGuidanceLevel: 'analysis-only',
    })
  })

  it('escalates explicit town targets to exact-target guidance', () => {
    const classification = classifyRequest(
      'Which town south of Yorkville is the best tornado target by 6 PM?',
    )

    expect(classification).toMatchObject({
      intent: 'severe-weather',
      chaseGuidanceLevel: 'exact-target',
    })
  })

  it('only allows full-route guidance for explicit route or direction prompts', () => {
    const classification = classifyRequest(
      'Give me a full chase route from Yorkville with intercept directions',
    )

    expect(classification).toMatchObject({
      intent: 'severe-weather',
      chaseGuidanceLevel: 'full-route',
    })
  })

  it('routes explicit named storm comparisons into severe-weather compare mode', () => {
    const classification = classifyRequest(
      'what about bloomington or paxton which line of storms look more favorable currently',
    )

    expect(classification).toMatchObject({
      intent: 'severe-weather',
      answerMode: 'compare',
      candidateMode: 'named',
      rankLimit: 2,
      rankingObjective: 'severe-favorability',
    })
  })

  it('routes top 5 beach prompts into discovered beach ranking', () => {
    const classification = classifyRequest('top 5 beach locations for tomorrow')

    expect(classification).toMatchObject({
      intent: 'forecast',
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankLimit: 5,
      rankingObjective: 'beach-day',
      locationRequired: false,
    })
  })

  it('defaults best-weather location rankings to the pleasant-weather rubric', () => {
    const classification = classifyRequest('best weather locations tomorrow')

    expect(classification).toMatchObject({
      intent: 'forecast',
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankLimit: 5,
      rankingObjective: 'pleasant-weather',
      locationRequired: false,
    })
  })
})

describe('classifyConversationRequest', () => {
  it('keeps multi-location severe compare context across the Bloomington and Paxton follow-up sequence', () => {
    const initial = classifyConversationRequest([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content:
              'where is the best spot to start chasing the storms today? and what time should i get there and how far should i track them before its night',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            content:
              'Start near the stronger corridor once radar and severe context line up.',
          },
          {
            type: 'weather-comparison-context',
            context: {
              workflow: 'severe-weather',
              answerMode: 'compare',
              candidateMode: 'named',
              rankLimit: 2,
              rankingObjective: 'severe-favorability',
              candidates: [
                {
                  query: 'Bloomington, IL',
                  label: 'Bloomington, IL',
                  location: {
                    query: 'Bloomington, IL',
                    name: 'Bloomington, Illinois, United States',
                    latitude: 40.4842,
                    longitude: -88.9937,
                    resolvedBy: 'pytest',
                  },
                  source: 'user',
                },
                {
                  query: 'Paxton, IL',
                  label: 'Paxton, IL',
                  location: {
                    query: 'Paxton, IL',
                    name: 'Paxton, Illinois, United States',
                    latitude: 40.4598,
                    longitude: -88.0956,
                    resolvedBy: 'pytest',
                  },
                  source: 'user',
                },
              ],
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content:
              'did you check the storms in blomington?',
          },
        ],
      },
    ])

    expect(initial).toMatchObject({
      intent: 'severe-weather',
      answerMode: 'compare',
      candidateMode: 'named',
      rankLimit: 2,
      rankingObjective: 'severe-favorability',
    })
  })

  it('keeps the prior severe-weather workflow for weather-tool follow-up questions', () => {
    const classification = classifyConversationRequest([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'any good storms this weekl?',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            content:
              "I wasn't able to pull up storm data for Chicago this week.",
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'what did you check?',
          },
        ],
      },
    ])

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: false,
      chaseGuidanceLevel: 'analysis-only',
    })
    expect(classification.timeHorizonHours).toBe(240)
  })

  it('treats SPC day 2 and 3 follow-ups as a 3 day severe-weather window', () => {
    const classification = classifyConversationRequest([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'any good storms this weekl?',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            content:
              "I wasn't able to pull up storm data for Chicago this week.",
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'check day 2 and 3 of spc',
          },
        ],
      },
    ])

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: true,
    })
    expect(classification.timeHorizonHours).toBe(72)
  })

  it('keeps discovered beach ranking context across a location-only follow-up after a limitation turn', () => {
    const classification = classifyConversationRequest([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'best area for beaches and when',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            content:
              'Tell me what area to search, like near Chicago or around Lake Michigan, and I can rank the best options there.',
          },
          {
            type: 'weather-comparison-context',
            context: {
              workflow: 'forecast',
              answerMode: 'rank',
              candidateMode: 'discovered',
              rankLimit: 5,
              rankingObjective: 'beach-day',
              candidates: [],
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'near chicago',
          },
        ],
      },
    ])

    expect(classification).toMatchObject({
      intent: 'forecast',
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankLimit: 5,
      rankingObjective: 'beach-day',
      locationRequired: false,
    })
  })

  it('keeps discovered beach ranking context across a bare-city follow-up after a limitation turn', () => {
    const classification = classifyConversationRequest([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'best area for beaches and when',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            content:
              'Tell me what area to search, like near Chicago or around Lake Michigan, and I can rank the best options there.',
          },
          {
            type: 'weather-comparison-context',
            context: {
              workflow: 'forecast',
              answerMode: 'rank',
              candidateMode: 'discovered',
              rankLimit: 5,
              rankingObjective: 'beach-day',
              candidates: [],
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'chicago',
          },
        ],
      },
    ])

    expect(classification).toMatchObject({
      intent: 'forecast',
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankLimit: 5,
      rankingObjective: 'beach-day',
      locationRequired: false,
    })
  })

  it('keeps discovered pleasant-weather ranking context across a location-only follow-up after a successful ranking', () => {
    const classification = classifyConversationRequest([
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'best weather locations this weekend',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'text',
            content:
              'The best-supported picks this weekend are north Austin, west Austin, and central Austin.',
          },
          {
            type: 'weather-comparison-context',
            context: {
              workflow: 'forecast',
              answerMode: 'rank',
              candidateMode: 'discovered',
              rankLimit: 5,
              rankingObjective: 'pleasant-weather',
              candidates: [
                {
                  query: 'North Austin',
                  label: 'North Austin',
                  location: {
                    query: 'North Austin',
                    name: 'North Austin, Texas, United States',
                    latitude: 30.35,
                    longitude: -97.73,
                    resolvedBy: 'pytest',
                  },
                  source: 'follow-up-context',
                },
              ],
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            content: 'near denver',
          },
        ],
      },
    ])

    expect(classification).toMatchObject({
      intent: 'forecast',
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankLimit: 5,
      rankingObjective: 'pleasant-weather',
      locationRequired: false,
    })
  })
})
