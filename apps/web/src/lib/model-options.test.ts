import { describe, expect, it } from 'vitest'
import { getAvailableModelOptions } from './model-options'

describe('getAvailableModelOptions', () => {
  it('includes the full Gemini text model set', () => {
    const options = getAvailableModelOptions(['gemini'])

    expect(options).toEqual([
      expect.objectContaining({
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro',
        model: 'gemini-3.1-pro-preview',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash-Lite',
        model: 'gemini-3.1-flash-lite-preview',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash',
        model: 'gemini-3-flash-preview',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        model: 'gemini-2.5-flash',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        model: 'gemini-2.5-pro',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        model: 'gemini-2.5-flash-lite',
        provider: 'gemini',
      }),
    ])
  })
})
