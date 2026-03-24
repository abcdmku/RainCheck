import { describe, expect, it } from 'vitest'

import { compareModels } from './models'

describe('compareModels', () => {
  it('builds a readable comparison summary', () => {
    const result = compareModels('Austin, TX', [
      {
        sourceId: 'gfs',
        modelLabel: 'GFS',
        runTime: '2026-03-24T00:00:00Z',
        validTime: '2026-03-25T12:00:00Z',
        summary: 'Broad synoptic lift remains west of Austin.',
      },
      {
        sourceId: 'ecmwf-open-data',
        modelLabel: 'ECMWF',
        runTime: '2026-03-24T00:00:00Z',
        validTime: '2026-03-25T12:00:00Z',
        summary: 'A slightly deeper trough supports faster precipitation.',
      },
    ])

    expect(result.consensus).toContain('GFS, ECMWF')
    expect(result.uncertainty).toContain('spread')
  })
})
