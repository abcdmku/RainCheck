// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import {
  loadStoredLocationPreference,
  saveStoredLocationPreference,
} from './location'

describe('location storage helpers', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('round-trips a stored custom location with coordinates', () => {
    saveStoredLocationPreference({
      mode: 'custom',
      value: {
        label: 'Yorkville, IL',
        latitude: 41.64,
        longitude: -88.45,
      },
    })

    expect(loadStoredLocationPreference()).toEqual({
      mode: 'custom',
      value: {
        label: 'Yorkville, IL',
        latitude: 41.64,
        longitude: -88.45,
      },
    })
  })

  it('drops cleared preferences from storage', () => {
    saveStoredLocationPreference({
      mode: 'cleared',
    })

    expect(loadStoredLocationPreference()).toBeNull()
  })
})
