import { describe, expect, it } from 'vitest'

import { classifyConversationRequest } from './classify-request'

describe('classifyConversationRequest', () => {
  it('keeps the prior severe-weather workflow for map follow-up turns', () => {
    const classification = classifyConversationRequest([
      {
        role: 'user',
        content:
          'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado. what time and where should i start the chase',
      },
      {
        role: 'assistant',
        content:
          'Northern Illinois has the main severe window later Thursday afternoon and evening.',
      },
      {
        role: 'user',
        content:
          'can you show on a map where i should go and mark the times i should be there',
      },
    ])

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: true,
      needsArtifact: true,
      chaseGuidanceLevel: 'general-target',
    })
  })

  it('inherits the prior workflow for short follow-up timing questions', () => {
    const classification = classifyConversationRequest([
      {
        role: 'user',
        content:
          'where are the most severe storms happening in the next 3 days',
      },
      {
        role: 'assistant',
        content: 'The broader severe corridor is centered farther south today.',
      },
      {
        role: 'user',
        content: 'what about tomorrow?',
      },
    ])

    expect(classification).toMatchObject({
      taskClass: 'research',
      intent: 'severe-weather',
      locationRequired: false,
      needsArtifact: false,
      chaseGuidanceLevel: 'analysis-only',
    })
    expect(classification.timeHorizonHours).toBe(48)
  })
})
