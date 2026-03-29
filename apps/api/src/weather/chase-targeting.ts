import type { RequestClassification } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import type { WeatherAnswerContext } from '../ai/weather-context'
import type { NormalizedWeatherLocation } from './derivation-plan'
import { getSevereContext } from './domain-tools'
import { geocodeQuery } from './geocode'
import { computeNightfall } from './solar'

type ChaseTarget = {
  query: string
  label: string
  location: NormalizedWeatherLocation
  regionLabel?: string
  startLabel?: string
  stopLabel?: string
  travelHours?: number
  corridorHours?: number
  withinNearbyRadius?: boolean
  supportScore?: number
}

type RegionalAnchor = {
  query: string
  name: string
  latitude: number
  longitude: number
  timezone: string
  regionLabel: string
  startLabel: string
  stopLabel?: string
  stopLatitude?: number
  stopLongitude?: number
}

type RegionalAnchorSet = {
  default: RegionalAnchor
  north?: RegionalAnchor
  south?: RegionalAnchor
  east?: RegionalAnchor
  west?: RegionalAnchor
  central?: RegionalAnchor
  northeast?: RegionalAnchor
  northwest?: RegionalAnchor
  southeast?: RegionalAnchor
  southwest?: RegionalAnchor
}

type CandidateSeed = {
  phrase: string
  stateName?: string
  zoneKey?: keyof RegionalAnchorSet
  supportScore: number
  directional: boolean
}

type RankedCandidate = ChaseTarget & {
  score: number
  directional: boolean
}

const nearbyRadiusHours = 3
const chaseRoadSpeedKmh = 88.5

const usStates = [
  'Arkansas',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Michigan',
  'Missouri',
  'Nebraska',
  'Ohio',
  'Oklahoma',
  'Tennessee',
  'Texas',
  'Wisconsin',
] as const

const directionAliases = {
  north: 'north',
  northern: 'north',
  south: 'south',
  southern: 'south',
  east: 'east',
  eastern: 'east',
  west: 'west',
  western: 'west',
  central: 'central',
  northeast: 'northeast',
  northeastern: 'northeast',
  northwest: 'northwest',
  northwestern: 'northwest',
  southeast: 'southeast',
  southeastern: 'southeast',
  southwest: 'southwest',
  southwestern: 'southwest',
} as const satisfies Record<string, keyof RegionalAnchorSet>

const directionPattern =
  'north(?:ern)?|south(?:ern)?|east(?:ern)?|west(?:ern)?|central|northeast(?:ern)?|northwest(?:ern)?|southeast(?:ern)?|southwest(?:ern)?'

const regionalAnchors: Partial<Record<(typeof usStates)[number], RegionalAnchorSet>> = {
  Illinois: {
    default: {
      query: 'Springfield, Illinois',
      name: 'Springfield, Illinois, United States',
      latitude: 39.7817,
      longitude: -89.6501,
      timezone: 'America/Chicago',
      regionLabel: 'central Illinois',
      startLabel: 'Springfield',
      stopLabel: 'Bloomington-Normal',
      stopLatitude: 40.4842,
      stopLongitude: -88.9937,
    },
    north: {
      query: 'Rochelle, Illinois',
      name: 'Rochelle, Illinois, United States',
      latitude: 41.9239,
      longitude: -89.0687,
      timezone: 'America/Chicago',
      regionLabel: 'northern Illinois',
      startLabel: 'Rochelle',
      stopLabel: 'DeKalb',
      stopLatitude: 41.9295,
      stopLongitude: -88.7504,
    },
    south: {
      query: 'Mount Vernon, Illinois',
      name: 'Mount Vernon, Illinois, United States',
      latitude: 38.3173,
      longitude: -88.9031,
      timezone: 'America/Chicago',
      regionLabel: 'southern Illinois',
      startLabel: 'Mount Vernon',
      stopLabel: 'Marion',
      stopLatitude: 37.7306,
      stopLongitude: -88.9331,
    },
    east: {
      query: 'Champaign, Illinois',
      name: 'Champaign, Illinois, United States',
      latitude: 40.1164,
      longitude: -88.2434,
      timezone: 'America/Chicago',
      regionLabel: 'eastern Illinois',
      startLabel: 'Champaign',
      stopLabel: 'Danville',
      stopLatitude: 40.1245,
      stopLongitude: -87.6300,
    },
    west: {
      query: 'Quincy, Illinois',
      name: 'Quincy, Illinois, United States',
      latitude: 39.9356,
      longitude: -91.4099,
      timezone: 'America/Chicago',
      regionLabel: 'western Illinois',
      startLabel: 'Quincy',
      stopLabel: 'Macomb',
      stopLatitude: 40.4592,
      stopLongitude: -90.6718,
    },
    central: {
      query: 'Springfield, Illinois',
      name: 'Springfield, Illinois, United States',
      latitude: 39.7817,
      longitude: -89.6501,
      timezone: 'America/Chicago',
      regionLabel: 'central Illinois',
      startLabel: 'Springfield',
      stopLabel: 'Bloomington-Normal',
      stopLatitude: 40.4842,
      stopLongitude: -88.9937,
    },
  },
  Indiana: {
    default: {
      query: 'Lafayette, Indiana',
      name: 'Lafayette, Indiana, United States',
      latitude: 40.4167,
      longitude: -86.8753,
      timezone: 'America/Indiana/Indianapolis',
      regionLabel: 'central Indiana',
      startLabel: 'Lafayette',
      stopLabel: 'Indianapolis',
      stopLatitude: 39.7684,
      stopLongitude: -86.1581,
    },
    north: {
      query: 'Valparaiso, Indiana',
      name: 'Valparaiso, Indiana, United States',
      latitude: 41.4731,
      longitude: -87.0611,
      timezone: 'America/Chicago',
      regionLabel: 'northern Indiana',
      startLabel: 'Valparaiso',
      stopLabel: 'Warsaw',
      stopLatitude: 41.2381,
      stopLongitude: -85.8530,
    },
    south: {
      query: 'Bloomington, Indiana',
      name: 'Bloomington, Indiana, United States',
      latitude: 39.1653,
      longitude: -86.5264,
      timezone: 'America/Indiana/Indianapolis',
      regionLabel: 'southern Indiana',
      startLabel: 'Bloomington',
      stopLabel: 'Jasper',
      stopLatitude: 38.3914,
      stopLongitude: -86.9311,
    },
    east: {
      query: 'Muncie, Indiana',
      name: 'Muncie, Indiana, United States',
      latitude: 40.1934,
      longitude: -85.3864,
      timezone: 'America/Indiana/Indianapolis',
      regionLabel: 'eastern Indiana',
      startLabel: 'Muncie',
      stopLabel: 'Richmond',
      stopLatitude: 39.8289,
      stopLongitude: -84.8902,
    },
    west: {
      query: 'Terre Haute, Indiana',
      name: 'Terre Haute, Indiana, United States',
      latitude: 39.4667,
      longitude: -87.4139,
      timezone: 'America/Indiana/Indianapolis',
      regionLabel: 'western Indiana',
      startLabel: 'Terre Haute',
      stopLabel: 'Lafayette',
      stopLatitude: 40.4167,
      stopLongitude: -86.8753,
    },
  },
  Iowa: {
    default: {
      query: 'Des Moines, Iowa',
      name: 'Des Moines, Iowa, United States',
      latitude: 41.5868,
      longitude: -93.6250,
      timezone: 'America/Chicago',
      regionLabel: 'central Iowa',
      startLabel: 'Des Moines',
      stopLabel: 'Ames',
      stopLatitude: 42.0308,
      stopLongitude: -93.6319,
    },
    north: {
      query: 'Fort Dodge, Iowa',
      name: 'Fort Dodge, Iowa, United States',
      latitude: 42.4975,
      longitude: -94.1680,
      timezone: 'America/Chicago',
      regionLabel: 'northern Iowa',
      startLabel: 'Fort Dodge',
      stopLabel: 'Mason City',
      stopLatitude: 43.1536,
      stopLongitude: -93.2010,
    },
    south: {
      query: 'Osceola, Iowa',
      name: 'Osceola, Iowa, United States',
      latitude: 41.0300,
      longitude: -93.7655,
      timezone: 'America/Chicago',
      regionLabel: 'southern Iowa',
      startLabel: 'Osceola',
      stopLabel: 'Creston',
      stopLatitude: 41.0586,
      stopLongitude: -94.3611,
    },
  },
  Missouri: {
    default: {
      query: 'Columbia, Missouri',
      name: 'Columbia, Missouri, United States',
      latitude: 38.9517,
      longitude: -92.3341,
      timezone: 'America/Chicago',
      regionLabel: 'central Missouri',
      startLabel: 'Columbia',
      stopLabel: 'Jefferson City',
      stopLatitude: 38.5767,
      stopLongitude: -92.1735,
    },
    north: {
      query: 'Kirksville, Missouri',
      name: 'Kirksville, Missouri, United States',
      latitude: 40.1948,
      longitude: -92.5833,
      timezone: 'America/Chicago',
      regionLabel: 'northern Missouri',
      startLabel: 'Kirksville',
      stopLabel: 'Moberly',
      stopLatitude: 39.4184,
      stopLongitude: -92.4388,
    },
    south: {
      query: 'Springfield, Missouri',
      name: 'Springfield, Missouri, United States',
      latitude: 37.2089,
      longitude: -93.2923,
      timezone: 'America/Chicago',
      regionLabel: 'southern Missouri',
      startLabel: 'Springfield',
      stopLabel: 'West Plains',
      stopLatitude: 36.7281,
      stopLongitude: -91.8524,
    },
    west: {
      query: 'Kansas City, Missouri',
      name: 'Kansas City, Missouri, United States',
      latitude: 39.0997,
      longitude: -94.5786,
      timezone: 'America/Chicago',
      regionLabel: 'western Missouri',
      startLabel: 'Kansas City',
      stopLabel: 'Sedalia',
      stopLatitude: 38.7045,
      stopLongitude: -93.2283,
    },
    east: {
      query: 'Cape Girardeau, Missouri',
      name: 'Cape Girardeau, Missouri, United States',
      latitude: 37.3059,
      longitude: -89.5181,
      timezone: 'America/Chicago',
      regionLabel: 'eastern Missouri',
      startLabel: 'Cape Girardeau',
      stopLabel: 'Farmington',
      stopLatitude: 37.7809,
      stopLongitude: -90.4201,
    },
  },
  Wisconsin: {
    default: {
      query: 'Madison, Wisconsin',
      name: 'Madison, Wisconsin, United States',
      latitude: 43.0731,
      longitude: -89.4012,
      timezone: 'America/Chicago',
      regionLabel: 'southern Wisconsin',
      startLabel: 'Madison',
      stopLabel: 'Janesville',
      stopLatitude: 42.6828,
      stopLongitude: -89.0187,
    },
    north: {
      query: 'Wausau, Wisconsin',
      name: 'Wausau, Wisconsin, United States',
      latitude: 44.9591,
      longitude: -89.6301,
      timezone: 'America/Chicago',
      regionLabel: 'northern Wisconsin',
      startLabel: 'Wausau',
      stopLabel: 'Rhinelander',
      stopLatitude: 45.6366,
      stopLongitude: -89.4121,
    },
    south: {
      query: 'Madison, Wisconsin',
      name: 'Madison, Wisconsin, United States',
      latitude: 43.0731,
      longitude: -89.4012,
      timezone: 'America/Chicago',
      regionLabel: 'southern Wisconsin',
      startLabel: 'Madison',
      stopLabel: 'Janesville',
      stopLatitude: 42.6828,
      stopLongitude: -89.0187,
    },
  },
  Michigan: {
    default: {
      query: 'Lansing, Michigan',
      name: 'Lansing, Michigan, United States',
      latitude: 42.7325,
      longitude: -84.5555,
      timezone: 'America/Detroit',
      regionLabel: 'central Lower Michigan',
      startLabel: 'Lansing',
      stopLabel: 'Jackson',
      stopLatitude: 42.2459,
      stopLongitude: -84.4013,
    },
    north: {
      query: 'Gaylord, Michigan',
      name: 'Gaylord, Michigan, United States',
      latitude: 45.0275,
      longitude: -84.6748,
      timezone: 'America/Detroit',
      regionLabel: 'northern Lower Michigan',
      startLabel: 'Gaylord',
      stopLabel: 'Alpena',
      stopLatitude: 45.0617,
      stopLongitude: -83.4327,
    },
    south: {
      query: 'Kalamazoo, Michigan',
      name: 'Kalamazoo, Michigan, United States',
      latitude: 42.2917,
      longitude: -85.5872,
      timezone: 'America/Detroit',
      regionLabel: 'southern Lower Michigan',
      startLabel: 'Kalamazoo',
      stopLabel: 'Battle Creek',
      stopLatitude: 42.3211,
      stopLongitude: -85.1797,
    },
  },
  Ohio: {
    default: {
      query: 'Columbus, Ohio',
      name: 'Columbus, Ohio, United States',
      latitude: 39.9612,
      longitude: -82.9988,
      timezone: 'America/New_York',
      regionLabel: 'central Ohio',
      startLabel: 'Columbus',
      stopLabel: 'Springfield',
      stopLatitude: 39.9242,
      stopLongitude: -83.8088,
    },
    west: {
      query: 'Dayton, Ohio',
      name: 'Dayton, Ohio, United States',
      latitude: 39.7589,
      longitude: -84.1916,
      timezone: 'America/New_York',
      regionLabel: 'western Ohio',
      startLabel: 'Dayton',
      stopLabel: 'Lima',
      stopLatitude: 40.7426,
      stopLongitude: -84.1052,
    },
    east: {
      query: 'Zanesville, Ohio',
      name: 'Zanesville, Ohio, United States',
      latitude: 39.9403,
      longitude: -82.0132,
      timezone: 'America/New_York',
      regionLabel: 'eastern Ohio',
      startLabel: 'Zanesville',
      stopLabel: 'New Philadelphia',
      stopLatitude: 40.4898,
      stopLongitude: -81.4457,
    },
    south: {
      query: 'Chillicothe, Ohio',
      name: 'Chillicothe, Ohio, United States',
      latitude: 39.3331,
      longitude: -82.9824,
      timezone: 'America/New_York',
      regionLabel: 'southern Ohio',
      startLabel: 'Chillicothe',
      stopLabel: 'Portsmouth',
      stopLatitude: 38.7317,
      stopLongitude: -82.9977,
    },
  },
  Kentucky: {
    default: {
      query: 'Lexington, Kentucky',
      name: 'Lexington, Kentucky, United States',
      latitude: 38.0406,
      longitude: -84.5037,
      timezone: 'America/New_York',
      regionLabel: 'central Kentucky',
      startLabel: 'Lexington',
      stopLabel: 'Frankfort',
      stopLatitude: 38.2009,
      stopLongitude: -84.8733,
    },
    west: {
      query: 'Paducah, Kentucky',
      name: 'Paducah, Kentucky, United States',
      latitude: 37.0834,
      longitude: -88.6000,
      timezone: 'America/Chicago',
      regionLabel: 'western Kentucky',
      startLabel: 'Paducah',
      stopLabel: 'Hopkinsville',
      stopLatitude: 36.8656,
      stopLongitude: -87.4886,
    },
    east: {
      query: 'London, Kentucky',
      name: 'London, Kentucky, United States',
      latitude: 37.1289,
      longitude: -84.0833,
      timezone: 'America/New_York',
      regionLabel: 'eastern Kentucky',
      startLabel: 'London',
      stopLabel: 'Hazard',
      stopLatitude: 37.2490,
      stopLongitude: -83.1932,
    },
  },
  Arkansas: {
    default: {
      query: 'Little Rock, Arkansas',
      name: 'Little Rock, Arkansas, United States',
      latitude: 34.7465,
      longitude: -92.2896,
      timezone: 'America/Chicago',
      regionLabel: 'central Arkansas',
      startLabel: 'Little Rock',
      stopLabel: 'Searcy',
      stopLatitude: 35.2506,
      stopLongitude: -91.7362,
    },
    northeast: {
      query: 'Jonesboro, Arkansas',
      name: 'Jonesboro, Arkansas, United States',
      latitude: 35.8423,
      longitude: -90.7043,
      timezone: 'America/Chicago',
      regionLabel: 'northeast Arkansas',
      startLabel: 'Jonesboro',
      stopLabel: 'Paragould',
      stopLatitude: 36.0584,
      stopLongitude: -90.4973,
    },
    south: {
      query: 'Pine Bluff, Arkansas',
      name: 'Pine Bluff, Arkansas, United States',
      latitude: 34.2284,
      longitude: -92.0032,
      timezone: 'America/Chicago',
      regionLabel: 'southern Arkansas',
      startLabel: 'Pine Bluff',
      stopLabel: 'El Dorado',
      stopLatitude: 33.2076,
      stopLongitude: -92.6651,
    },
  },
  Oklahoma: {
    default: {
      query: 'Oklahoma City, Oklahoma',
      name: 'Oklahoma City, Oklahoma, United States',
      latitude: 35.4676,
      longitude: -97.5164,
      timezone: 'America/Chicago',
      regionLabel: 'central Oklahoma',
      startLabel: 'Oklahoma City',
      stopLabel: 'Norman',
      stopLatitude: 35.2226,
      stopLongitude: -97.4395,
    },
    north: {
      query: 'Enid, Oklahoma',
      name: 'Enid, Oklahoma, United States',
      latitude: 36.3956,
      longitude: -97.8784,
      timezone: 'America/Chicago',
      regionLabel: 'northern Oklahoma',
      startLabel: 'Enid',
      stopLabel: 'Ponca City',
      stopLatitude: 36.7069,
      stopLongitude: -97.0856,
    },
    south: {
      query: 'Ardmore, Oklahoma',
      name: 'Ardmore, Oklahoma, United States',
      latitude: 34.1743,
      longitude: -97.1436,
      timezone: 'America/Chicago',
      regionLabel: 'southern Oklahoma',
      startLabel: 'Ardmore',
      stopLabel: 'Durant',
      stopLatitude: 33.9918,
      stopLongitude: -96.3708,
    },
    west: {
      query: 'El Reno, Oklahoma',
      name: 'El Reno, Oklahoma, United States',
      latitude: 35.5323,
      longitude: -97.9550,
      timezone: 'America/Chicago',
      regionLabel: 'western Oklahoma',
      startLabel: 'El Reno',
      stopLabel: 'Weatherford',
      stopLatitude: 35.5262,
      stopLongitude: -98.7076,
    },
    east: {
      query: 'Tulsa, Oklahoma',
      name: 'Tulsa, Oklahoma, United States',
      latitude: 36.1540,
      longitude: -95.9928,
      timezone: 'America/Chicago',
      regionLabel: 'eastern Oklahoma',
      startLabel: 'Tulsa',
      stopLabel: 'Muskogee',
      stopLatitude: 35.7479,
      stopLongitude: -95.3697,
    },
  },
  Kansas: {
    default: {
      query: 'Wichita, Kansas',
      name: 'Wichita, Kansas, United States',
      latitude: 37.6872,
      longitude: -97.3301,
      timezone: 'America/Chicago',
      regionLabel: 'central Kansas',
      startLabel: 'Wichita',
      stopLabel: 'Hutchinson',
      stopLatitude: 38.0608,
      stopLongitude: -97.9298,
    },
    north: {
      query: 'Salina, Kansas',
      name: 'Salina, Kansas, United States',
      latitude: 38.8403,
      longitude: -97.6114,
      timezone: 'America/Chicago',
      regionLabel: 'northern Kansas',
      startLabel: 'Salina',
      stopLabel: 'Concordia',
      stopLatitude: 39.5708,
      stopLongitude: -97.6625,
    },
    south: {
      query: 'Wichita, Kansas',
      name: 'Wichita, Kansas, United States',
      latitude: 37.6872,
      longitude: -97.3301,
      timezone: 'America/Chicago',
      regionLabel: 'southern Kansas',
      startLabel: 'Wichita',
      stopLabel: 'Winfield',
      stopLatitude: 37.2395,
      stopLongitude: -96.9956,
    },
    west: {
      query: 'Dodge City, Kansas',
      name: 'Dodge City, Kansas, United States',
      latitude: 37.7528,
      longitude: -100.0171,
      timezone: 'America/Chicago',
      regionLabel: 'western Kansas',
      startLabel: 'Dodge City',
      stopLabel: 'Garden City',
      stopLatitude: 37.9717,
      stopLongitude: -100.8727,
    },
    east: {
      query: 'Emporia, Kansas',
      name: 'Emporia, Kansas, United States',
      latitude: 38.4039,
      longitude: -96.1817,
      timezone: 'America/Chicago',
      regionLabel: 'eastern Kansas',
      startLabel: 'Emporia',
      stopLabel: 'Topeka',
      stopLatitude: 39.0473,
      stopLongitude: -95.6752,
    },
  },
  Nebraska: {
    default: {
      query: 'Kearney, Nebraska',
      name: 'Kearney, Nebraska, United States',
      latitude: 40.6995,
      longitude: -99.0815,
      timezone: 'America/Chicago',
      regionLabel: 'central Nebraska',
      startLabel: 'Kearney',
      stopLabel: 'Grand Island',
      stopLatitude: 40.9264,
      stopLongitude: -98.3420,
    },
    north: {
      query: 'Valentine, Nebraska',
      name: 'Valentine, Nebraska, United States',
      latitude: 42.8728,
      longitude: -100.5510,
      timezone: 'America/Chicago',
      regionLabel: 'northern Nebraska',
      startLabel: 'Valentine',
      stopLabel: "O'Neill",
      stopLatitude: 42.4575,
      stopLongitude: -98.6476,
    },
    south: {
      query: 'Hastings, Nebraska',
      name: 'Hastings, Nebraska, United States',
      latitude: 40.5863,
      longitude: -98.3899,
      timezone: 'America/Chicago',
      regionLabel: 'southern Nebraska',
      startLabel: 'Hastings',
      stopLabel: 'Beatrice',
      stopLatitude: 40.2681,
      stopLongitude: -96.7461,
    },
    west: {
      query: 'North Platte, Nebraska',
      name: 'North Platte, Nebraska, United States',
      latitude: 41.1403,
      longitude: -100.7601,
      timezone: 'America/Chicago',
      regionLabel: 'western Nebraska',
      startLabel: 'North Platte',
      stopLabel: 'Ogallala',
      stopLatitude: 41.1280,
      stopLongitude: -101.7196,
    },
  },
  Tennessee: {
    default: {
      query: 'Nashville, Tennessee',
      name: 'Nashville, Tennessee, United States',
      latitude: 36.1627,
      longitude: -86.7816,
      timezone: 'America/Chicago',
      regionLabel: 'middle Tennessee',
      startLabel: 'Nashville',
      stopLabel: 'Cookeville',
      stopLatitude: 36.1628,
      stopLongitude: -85.5016,
    },
    west: {
      query: 'Jackson, Tennessee',
      name: 'Jackson, Tennessee, United States',
      latitude: 35.6145,
      longitude: -88.8139,
      timezone: 'America/Chicago',
      regionLabel: 'western Tennessee',
      startLabel: 'Jackson',
      stopLabel: 'Dyersburg',
      stopLatitude: 36.0348,
      stopLongitude: -89.3856,
    },
    east: {
      query: 'Knoxville, Tennessee',
      name: 'Knoxville, Tennessee, United States',
      latitude: 35.9606,
      longitude: -83.9207,
      timezone: 'America/New_York',
      regionLabel: 'eastern Tennessee',
      startLabel: 'Knoxville',
      stopLabel: 'Morristown',
      stopLatitude: 36.2139,
      stopLongitude: -83.2949,
    },
  },
  Texas: {
    default: {
      query: 'Abilene, Texas',
      name: 'Abilene, Texas, United States',
      latitude: 32.4487,
      longitude: -99.7331,
      timezone: 'America/Chicago',
      regionLabel: 'west-central Texas',
      startLabel: 'Abilene',
      stopLabel: 'Sweetwater',
      stopLatitude: 32.4709,
      stopLongitude: -100.4059,
    },
    north: {
      query: 'Wichita Falls, Texas',
      name: 'Wichita Falls, Texas, United States',
      latitude: 33.9137,
      longitude: -98.4934,
      timezone: 'America/Chicago',
      regionLabel: 'north Texas',
      startLabel: 'Wichita Falls',
      stopLabel: 'Vernon',
      stopLatitude: 34.1545,
      stopLongitude: -99.2651,
    },
    south: {
      query: 'San Angelo, Texas',
      name: 'San Angelo, Texas, United States',
      latitude: 31.4638,
      longitude: -100.4370,
      timezone: 'America/Chicago',
      regionLabel: 'southwest Texas',
      startLabel: 'San Angelo',
      stopLabel: 'Del Rio',
      stopLatitude: 29.3709,
      stopLongitude: -100.8959,
    },
    east: {
      query: 'Tyler, Texas',
      name: 'Tyler, Texas, United States',
      latitude: 32.3513,
      longitude: -95.3011,
      timezone: 'America/Chicago',
      regionLabel: 'east Texas',
      startLabel: 'Tyler',
      stopLabel: 'Longview',
      stopLatitude: 32.5007,
      stopLongitude: -94.7405,
    },
    west: {
      query: 'Lubbock, Texas',
      name: 'Lubbock, Texas, United States',
      latitude: 33.5779,
      longitude: -101.8552,
      timezone: 'America/Chicago',
      regionLabel: 'west Texas',
      startLabel: 'Lubbock',
      stopLabel: 'Plainview',
      stopLatitude: 34.1848,
      stopLongitude: -101.7068,
    },
  },
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeDirectionToken(
  value: string,
): keyof RegionalAnchorSet | undefined {
  return directionAliases[value.toLowerCase() as keyof typeof directionAliases]
}

function directionLabelForKey(value: keyof RegionalAnchorSet) {
  switch (value) {
    case 'north':
      return 'northern'
    case 'south':
      return 'southern'
    case 'east':
      return 'eastern'
    case 'west':
      return 'western'
    case 'central':
      return 'central'
    case 'northeast':
      return 'northeast'
    case 'northwest':
      return 'northwest'
    case 'southeast':
      return 'southeast'
    case 'southwest':
      return 'southwest'
    default:
      return ''
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function applyTimezone(
  location: NormalizedWeatherLocation,
  displayTimezone?: string,
) {
  if (location.timezone || !displayTimezone) {
    return location
  }

  return {
    ...location,
    timezone: displayTimezone,
  }
}

export async function resolveOriginLocation(input: {
  app: FastifyInstance
  context?: WeatherAnswerContext
  fallbackLocation?: NormalizedWeatherLocation | null
}) {
  const locationHint = input.context?.locationHint
  const displayTimezone = input.context?.displayTimezone

  if (
    locationHint?.label &&
    isFiniteNumber(locationHint.latitude) &&
    isFiniteNumber(locationHint.longitude)
  ) {
    return {
      query: locationHint.label,
      name: locationHint.label,
      latitude: locationHint.latitude,
      longitude: locationHint.longitude,
      timezone: locationHint.timezone ?? displayTimezone,
      resolvedBy: 'chat-location-override',
    } satisfies NormalizedWeatherLocation
  }

  if (locationHint?.label) {
    try {
      return applyTimezone(
        {
          ...(await geocodeQuery(input.app, locationHint.label)),
          query: locationHint.label,
        },
        locationHint.timezone ?? displayTimezone,
      )
    } catch {
      // Best-effort only.
    }
  }

  if (!input.fallbackLocation) {
    return null
  }

  return applyTimezone(input.fallbackLocation, displayTimezone)
}

function haversineDistanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const earthRadiusKm = 6371
  const deltaLatitude = (right.latitude - left.latitude) * (Math.PI / 180)
  const deltaLongitude = (right.longitude - left.longitude) * (Math.PI / 180)
  const latitudeA = left.latitude * (Math.PI / 180)
  const latitudeB = right.latitude * (Math.PI / 180)
  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2)

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function estimateDriveHoursKm(distanceKm: number) {
  return Number((distanceKm / chaseRoadSpeedKmh).toFixed(1))
}

function buildTargetLabel(anchor: RegionalAnchor) {
  return anchor.stopLabel
    ? `${anchor.startLabel} to ${anchor.stopLabel} in ${anchor.regionLabel}`
    : `${anchor.startLabel} in ${anchor.regionLabel}`
}

function stateNameFromRegion(value: string | undefined) {
  if (!value) {
    return undefined
  }

  return usStates.find(
    (stateName) => stateName.toLowerCase() === value.trim().toLowerCase(),
  )
}

function buildAnchorTarget(
  stateName: (typeof usStates)[number],
  zoneKey: keyof RegionalAnchorSet | undefined,
  supportScore: number,
  originLocation: NormalizedWeatherLocation,
) {
  const anchorSet = regionalAnchors[stateName]
  if (!anchorSet) {
    return null
  }

  const anchor =
    (zoneKey && anchorSet[zoneKey]) || anchorSet.default || anchorSet.central
  if (!anchor) {
    return null
  }

  const location = {
    query: anchor.query,
    name: anchor.name,
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    region: stateName,
    country: 'United States',
    timezone: anchor.timezone,
    resolvedBy: 'raincheck-regional-anchor',
  } satisfies NormalizedWeatherLocation
  const travelHours = estimateDriveHoursKm(
    haversineDistanceKm(originLocation, location),
  )
  const corridorHours =
    isFiniteNumber(anchor.stopLatitude) && isFiniteNumber(anchor.stopLongitude)
      ? estimateDriveHoursKm(
          haversineDistanceKm(
            { latitude: anchor.latitude, longitude: anchor.longitude },
            {
              latitude: anchor.stopLatitude,
              longitude: anchor.stopLongitude,
            },
          ),
        )
      : undefined

  return {
    query: anchor.query,
    label: buildTargetLabel(anchor),
    location,
    regionLabel: anchor.regionLabel,
    startLabel: anchor.startLabel,
    stopLabel: anchor.stopLabel,
    travelHours,
    corridorHours,
    withinNearbyRadius: travelHours <= nearbyRadiusHours,
    supportScore,
  } satisfies ChaseTarget
}

function candidateScore(candidate: ChaseTarget, directional: boolean) {
  let score = candidate.supportScore ?? 0.6

  if (directional) {
    score += 0.03
  }

  if (typeof candidate.travelHours === 'number') {
    if (candidate.travelHours >= 1 && candidate.travelHours <= nearbyRadiusHours) {
      score += 0.08
    } else if (
      candidate.travelHours > nearbyRadiusHours &&
      candidate.travelHours <= 5
    ) {
      score += 0.01
    } else if (candidate.travelHours < 0.75) {
      score -= 0.05
    } else if (candidate.travelHours > 6) {
      score -= 0.08
    }
  }

  return Number(score.toFixed(3))
}

function buildDirectionalPhrase(
  directionKey: keyof RegionalAnchorSet,
  stateName: string,
) {
  const prefix = directionLabelForKey(directionKey)
  return prefix ? `${prefix} ${stateName}` : stateName
}

function severityText(envelope: Awaited<ReturnType<typeof getSevereContext>>) {
  const productTexts = Array.isArray((envelope.data as any)?.products)
    ? ((envelope.data as any).products as Array<Record<string, unknown>>).flatMap(
        (product) => [
          typeof product.riskHeadline === 'string' ? product.riskHeadline : '',
          typeof product.summary === 'string' ? product.summary : '',
          typeof product.locationRelevance === 'string'
            ? product.locationRelevance
            : '',
        ],
      )
    : []

  return [envelope.summary, ...productTexts].filter(Boolean).join(' ')
}

function extractCandidateSeeds(text: string, originState?: string) {
  const directionalSeeds = new Map<string, CandidateSeed>()
  const plainSeeds = new Map<string, CandidateSeed>()

  for (const stateName of usStates) {
    const directionalRegex = new RegExp(
      `((?:${directionPattern})(?:\\s*(?:,|and)\\s*(?:${directionPattern}))*)\\s+${escapeRegExp(stateName)}`,
      'gi',
    )

    for (const match of text.matchAll(directionalRegex)) {
      const directionList = String(match[1] ?? '')
        .split(/\s*(?:,|and)\s*/i)
        .map((value) => normalizeDirectionToken(value))
        .filter((value): value is keyof RegionalAnchorSet => Boolean(value))

      for (const directionKey of directionList) {
        const phrase = buildDirectionalPhrase(directionKey, stateName)
        directionalSeeds.set(phrase.toLowerCase(), {
          phrase,
          stateName,
          zoneKey: directionKey,
          supportScore: stateName === originState ? 0.78 : 0.74,
          directional: true,
        })
      }
    }

    const plainRegex = new RegExp(`\\b${escapeRegExp(stateName)}\\b`, 'gi')
    if (!plainRegex.test(text)) {
      continue
    }

    plainSeeds.set(stateName.toLowerCase(), {
      phrase: stateName,
      stateName,
      supportScore: stateName === originState ? 0.68 : 0.64,
      directional: false,
    })
  }

  if (originState && !plainSeeds.has(originState.toLowerCase())) {
    plainSeeds.set(originState.toLowerCase(), {
      phrase: originState,
      stateName: originState,
      supportScore: 0.6,
      directional: false,
    })
  }

  return [...directionalSeeds.values(), ...plainSeeds.values()]
}

async function buildFallbackTarget(input: {
  app: FastifyInstance
  seed: CandidateSeed
  originLocation: NormalizedWeatherLocation
}) {
  try {
    const resolved = await geocodeQuery(input.app, input.seed.phrase)
    const location = {
      ...resolved,
      query: input.seed.phrase,
    } satisfies NormalizedWeatherLocation
    const travelHours = estimateDriveHoursKm(
      haversineDistanceKm(input.originLocation, location),
    )
    const label = input.seed.directional
      ? input.seed.phrase
      : input.seed.stateName
        ? `${input.seed.stateName}`
        : input.seed.phrase

    return {
      query: input.seed.phrase,
      label,
      location,
      regionLabel: input.seed.directional ? input.seed.phrase : undefined,
      travelHours,
      withinNearbyRadius: travelHours <= nearbyRadiusHours,
      supportScore: input.seed.supportScore,
    } satisfies ChaseTarget
  } catch {
    return null
  }
}

async function resolveCandidate(input: {
  app: FastifyInstance
  seed: CandidateSeed
  originLocation: NormalizedWeatherLocation
}) {
  const stateName = input.seed.stateName
    ? stateNameFromRegion(input.seed.stateName)
    : undefined

  if (stateName) {
    const anchored = buildAnchorTarget(
      stateName,
      input.seed.zoneKey,
      input.seed.supportScore,
      input.originLocation,
    )
    if (anchored) {
      return anchored
    }
  }

  return buildFallbackTarget(input)
}

function rankedCandidates(candidates: Array<RankedCandidate>) {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    const leftTravel = left.travelHours ?? Number.MAX_SAFE_INTEGER
    const rightTravel = right.travelHours ?? Number.MAX_SAFE_INTEGER
    return leftTravel - rightTravel
  })
}

export async function rankBroadChaseTargets(input: {
  app: FastifyInstance
  originLocation: NormalizedWeatherLocation
  referenceTime?: string
}) {
  const severeContextQuery =
    input.originLocation.region?.trim() ||
    input.originLocation.country?.trim() ||
    input.originLocation.query
  const severeContext = await getSevereContext(input.app, severeContextQuery)
  const seeds = extractCandidateSeeds(
    severityText(severeContext),
    input.originLocation.region,
  )

  const resolvedCandidates = (
    await Promise.all(
      seeds.map(async (seed): Promise<RankedCandidate | null> => {
        const target = await resolveCandidate({
          app: input.app,
          seed,
          originLocation: input.originLocation,
        })
        if (!target) {
          return null
        }

        return {
          ...target,
          score: candidateScore(target, seed.directional),
          directional: seed.directional,
        } satisfies RankedCandidate
      }),
    )
  ).filter((candidate): candidate is RankedCandidate => candidate != null)

  const dedupedCandidates: Array<RankedCandidate> = [
    ...new Map(
      resolvedCandidates.map((candidate) => [
        candidate.label.toLowerCase(),
        candidate,
      ]),
    ).values(),
  ]
  const nearbyCandidates = dedupedCandidates.filter(
    (candidate) => candidate.withinNearbyRadius,
  )

  return {
    severeContextQuery,
    severeContext,
    candidates: rankedCandidates(
      nearbyCandidates.length > 0 ? nearbyCandidates : dedupedCandidates,
    ).map(
      (candidate): RankedCandidate => ({
        ...candidate,
        withinNearbyRadius:
          nearbyCandidates.length > 0 ? true : candidate.withinNearbyRadius,
      }),
    ),
  }
}

export function isBroadSevereLocatorQuestion(
  classification: RequestClassification,
  userQuestion: string,
) {
  if (
    classification.intent !== 'severe-weather' ||
    classification.locationRequired
  ) {
    return false
  }

  return /\b(where (?:are|will|is)|best (?:storms?|spot|place|area)|start chasing|start the chase|where should i start|what time and where|where should i go|where should i be|follow these storms)\b/i.test(
    userQuestion,
  )
}

export async function selectBroadChaseTarget(input: {
  app: FastifyInstance
  originLocation: NormalizedWeatherLocation
  referenceTime?: string
}) {
  const ranked = await rankBroadChaseTargets(input)
  if (ranked.candidates.length === 0) {
    return null
  }
  const selected = ranked.candidates[0]
  if (!selected) {
    return null
  }

  const nightfall = computeNightfall({
    latitude: selected.location.latitude,
    longitude: selected.location.longitude,
    timeZone: selected.location.timezone,
    referenceTime: input.referenceTime,
  })

  return {
    severeContextQuery: ranked.severeContextQuery,
    severeContext: ranked.severeContext,
    selectedTarget: {
      ...selected,
    } satisfies ChaseTarget,
    nightfall,
  }
}
