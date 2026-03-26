import { describe, expect, it } from 'vitest'

import {
  formatIsoLocalTimeRange,
  normalizeTimingLanguage,
} from './timing-language'

describe('timing language helpers', () => {
  it('replaces vague dayparts with explicit local clock ranges', () => {
    expect(
      normalizeTimingLanguage(
        'Storms peak late Thursday afternoon and evening across northern Illinois.',
      ),
    ).toBe(
      'Storms peak 4 PM to 10 PM Thursday local time across northern Illinois.',
    )
  })

  it('formats ISO ranges into local clock windows', () => {
    expect(
      formatIsoLocalTimeRange(
        '2026-03-25T18:00:00-05:00',
        '2026-03-25T23:00:00-05:00',
        {
          includeDay: true,
        },
      ),
    ).toBe('6 PM to 11 PM Wednesday local time')
  })
})
