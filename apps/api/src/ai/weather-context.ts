import type { AnswerTone, TimeDisplay } from '@raincheck/contracts'

export type WeatherLocationHint = {
  label?: string
  latitude?: number
  longitude?: number
  timezone?: string
}

export type WeatherAnswerContext = {
  answerTone: AnswerTone
  displayTimezone?: string
  timeDisplay: TimeDisplay
  locationHint?: WeatherLocationHint
}
