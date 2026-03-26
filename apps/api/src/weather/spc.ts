import type { Citation } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherText,
  normalizeWhitespace,
  summarizeText,
  type WeatherEnvelope,
  type WeatherLocationSummary,
} from './runtime'

type SpcProduct = {
  productId: string
  title: string
  summary: string
  url: string
  imageUrl?: string
  validRange?: {
    start: string
    end: string
  }
  riskHeadline?: string
  locationRelevance?: string
}

type SpcSevereData = {
  products: Array<SpcProduct>
  watchContext: string
  watchUrl: string
  mesoscaleContext: string
  mesoscaleUrl: string
  mesoanalysisUrl: string
}

type SpcPageConfig = {
  productId: string
  title: string
  url: string
  cacheName: string
}

const nationalLocation = {
  query: 'United States',
  name: 'Contiguous United States',
  latitude: 39.8283,
  longitude: -98.5795,
  country: 'United States',
  resolvedBy: 'spc-national-default',
} satisfies WeatherLocationSummary

const day1Config = {
  productId: 'spc-day1-convective-outlook',
  title: 'SPC Day 1 Convective Outlook',
  url: 'https://www.spc.noaa.gov/products/outlook/day1otlk.html',
  cacheName: 'day1-convective-outlook',
} satisfies SpcPageConfig

const day2Config = {
  productId: 'spc-day2-convective-outlook',
  title: 'SPC Day 2 Convective Outlook',
  url: 'https://www.spc.noaa.gov/products/outlook/day2otlk.html',
  cacheName: 'day2-convective-outlook',
} satisfies SpcPageConfig

const day3Config = {
  productId: 'spc-day3-convective-outlook',
  title: 'SPC Day 3 Convective Outlook',
  url: 'https://www.spc.noaa.gov/products/outlook/day3otlk.html',
  cacheName: 'day3-convective-outlook',
} satisfies SpcPageConfig

const day4To8Config = {
  productId: 'spc-day4-8-convective-outlook',
  title: 'SPC Day 4-8 Convective Outlook',
  url: 'https://www.spc.noaa.gov/products/exper/day4-8/',
  cacheName: 'day4-8-convective-outlook',
} satisfies SpcPageConfig

const currentWatchesConfig = {
  productId: 'spc-current-convective-watches',
  title: 'SPC Current Convective Watches',
  url: 'https://www.spc.noaa.gov/products/watch/',
  cacheName: 'current-convective-watches',
} satisfies SpcPageConfig

const currentMesoscaleConfig = {
  productId: 'spc-current-mesoscale-discussions',
  title: 'SPC Current Mesoscale Discussions',
  url: 'https://www.spc.noaa.gov/products/md/',
  cacheName: 'current-mesoscale-discussions',
} satisfies SpcPageConfig

const mesoanalysisUrl = 'https://www.spc.noaa.gov/exper/mesoanalysis/'

function isNationalQuery(query: string) {
  const normalized = query.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    normalized === 'united states' ||
    normalized === 'us' ||
    normalized === 'usa' ||
    normalized === 'national' ||
    normalized === 'nationwide' ||
    normalized === 'conus'
  )
}

async function resolveSpcLocation(app: FastifyInstance, locationQuery: string) {
  if (isNationalQuery(locationQuery)) {
    const query = locationQuery.trim() || nationalLocation.query
    return {
      ...nationalLocation,
      query,
    }
  }

  return geocodeQuery(app, locationQuery)
}

async function loadSpcPage(app: FastifyInstance, config: SpcPageConfig) {
  return fetchWeatherText(app, {
    sourceId: 'spc',
    productId: config.productId,
    label: config.title,
    url: config.url,
    cacheKey: cacheKey('spc', config.cacheName),
    ttlMs: 10 * 60 * 1000,
  })
}

function parseValidRange(text: string) {
  const compactMatch = text.match(/Valid\s+([0-9]{6}Z)\s*-\s*([0-9]{6}Z)/i)
  if (compactMatch?.[1] && compactMatch[2]) {
    return {
      start: compactMatch[1].trim(),
      end: compactMatch[2].trim(),
    }
  }

  const verboseMatch = text.match(
    /Valid\s+(.+?\d{4})\s+Through\s+(.+?\d{4})(?:\s+[A-Z][\s\S]*|$)/i,
  )
  if (!verboseMatch?.[1] || !verboseMatch[2]) {
    return undefined
  }

  return {
    start: verboseMatch[1].trim(),
    end: verboseMatch[2].trim(),
  }
}

function cleanNarrative(value: string | undefined) {
  if (!value) {
    return ''
  }

  return normalizeWhitespace(value.replace(/\.\.\./g, ' '))
}

function htmlToPlainText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|pre|tr|table|center|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
}

function extractRiskHeadline(text: string) {
  const match = text.match(
    /Valid\s+[^\n]+\n+([\s\S]*?)(?=\n+\.\.\.SUMMARY\.\.\.|\n+\.\.\.DISCUSSION\.\.\.|CLICK TO GET|NOTE:|$)/i,
  )
  return cleanNarrative(match?.[1])
}

function extractSection(text: string, heading: 'SUMMARY' | 'DISCUSSION') {
  const match = text.match(
    new RegExp(
      `\\.\\.\\.${heading}\\.\\.\\.\\s*([\\s\\S]*?)(?=\\n+\\.\\.\\.[A-Z][\\s\\S]*?\\.\\.\\.|\\n+\\.\\.[A-Za-z]+\\.\\.|CLICK TO GET|NOTE:|$)`,
      'i',
    ),
  )
  return cleanNarrative(match?.[1])
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function describeLocationRelevance(
  location: WeatherLocationSummary,
  productText: string,
) {
  const locality = location.name.split(',')[0]?.trim()
  if (
    location.region &&
    new RegExp(`\\b${escapeRegExp(location.region)}\\b`, 'i').test(productText)
  ) {
    return locality
      ? `${location.region} is explicitly mentioned in this outlook, which includes ${locality}.`
      : `${location.region} is explicitly mentioned in this outlook.`
  }

  if (
    locality &&
    new RegExp(`\\b${escapeRegExp(locality)}\\b`, 'i').test(productText)
  ) {
    return `${locality} is explicitly mentioned in this outlook.`
  }

  return undefined
}

function hasActiveRisk(product: SpcProduct) {
  return Boolean(
    product.riskHeadline &&
      !/no severe thunderstorm areas forecast/i.test(product.riskHeadline),
  )
}

function buildProductSummary(product: SpcProduct) {
  const parts = [
    product.riskHeadline,
    product.summary,
    product.locationRelevance,
  ].filter(Boolean)

  return summarizeText(parts.join(' '), 360)
}

function buildProduct(
  location: WeatherLocationSummary,
  config: SpcPageConfig,
  html: string,
): SpcProduct {
  const text = htmlToPlainText(html)
  const riskHeadline = extractRiskHeadline(text)
  const summary =
    extractSection(text, 'SUMMARY') ||
    extractSection(text, 'DISCUSSION') ||
    `Official severe-weather outlook for ${location.name}.`
  const locationRelevance = describeLocationRelevance(
    location,
    `${riskHeadline} ${summary}`,
  )

  return {
    productId: config.productId,
    title: config.title,
    summary,
    url: config.url,
    imageUrl: buildGraphicUrl(config, html),
    validRange: parseValidRange(text),
    riskHeadline: riskHeadline || undefined,
    locationRelevance,
  }
}

function extractDefaultTabToken(html: string) {
  const match = html.match(/show_tab\('([^']+)'\)/i)
  return match?.[1]
}

function buildGraphicUrl(config: SpcPageConfig, html: string) {
  const tabToken = extractDefaultTabToken(html)
  if (!tabToken) {
    return undefined
  }

  switch (config.productId) {
    case 'spc-day1-convective-outlook':
      return new URL(`day1${tabToken}.png`, config.url).toString()
    case 'spc-day2-convective-outlook':
      return new URL(`day2${tabToken}.png`, config.url).toString()
    case 'spc-day3-convective-outlook':
      return new URL(`day3${tabToken}.png`, config.url).toString()
    case 'spc-day4-8-convective-outlook':
      return new URL(`day${tabToken}prob.gif`, config.url).toString()
    default:
      return undefined
  }
}

function parseWatchContext(text: string) {
  if (/No watches are currently valid/i.test(text)) {
    const recentWatch = text.match(/Most recently issued watch #(\d+)/i)
    return recentWatch?.[1]
      ? `No watches are currently valid. Most recently issued watch #${recentWatch[1]}.`
      : 'No watches are currently valid.'
  }

  const activeWatch = text.match(/Watch (?:Number )?#?(\d+)[\s\S]{0,180}/i)
  return activeWatch
    ? cleanNarrative(activeWatch[0])
    : 'See the SPC current convective watches page for the latest watch status.'
}

function parseMesoscaleContext(text: string) {
  if (/No Mesoscale Discussions are currently in effect/i.test(text)) {
    const recentDiscussion = text.match(
      /Most recently issued Mesoscale Discussion #(\d+)/i,
    )
    return recentDiscussion?.[1]
      ? `No mesoscale discussions are currently in effect. Most recently issued discussion #${recentDiscussion[1]}.`
      : 'No mesoscale discussions are currently in effect.'
  }

  const activeDiscussion = text.match(
    /Mesoscale Discussion #?(\d+)[\s\S]{0,180}/i,
  )
  return activeDiscussion
    ? cleanNarrative(activeDiscussion[0])
    : 'See the SPC current mesoscale discussions page for the latest mesoscale updates.'
}

function buildCitation(
  productId: string,
  label: string,
  url: string,
  issuedAt?: string,
) {
  return {
    id: `spc:${productId}`,
    label,
    sourceId: 'spc',
    productId,
    kind: 'page',
    url,
    issuedAt,
  } satisfies Citation
}

export async function getSpcSevereProducts(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<SpcSevereData>> {
  const location = await resolveSpcLocation(app, locationQuery)
  const pageResults = await Promise.allSettled([
    loadSpcPage(app, day1Config),
    loadSpcPage(app, day2Config),
    loadSpcPage(app, day3Config),
    loadSpcPage(app, day4To8Config),
    loadSpcPage(app, currentWatchesConfig),
    loadSpcPage(app, currentMesoscaleConfig),
  ])

  const successfulResults = pageResults
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof loadSpcPage>>
      > => result.status === 'fulfilled',
    )
    .map((result) => result.value)

  if (successfulResults.length === 0) {
    throw new Error('SPC severe-weather products could not be fetched.')
  }

  const lookup = new Map(
    successfulResults.map((result) => [result.source.productId, result]),
  )

  const products = [day1Config, day2Config, day3Config, day4To8Config]
    .map((config) => {
      const page = lookup.get(config.productId)
      if (!page) {
        return null
      }

      return buildProduct(location, config, page.value)
    })
    .filter((product): product is SpcProduct => product != null)

  const watchPage = lookup.get(currentWatchesConfig.productId)
  const mesoscalePage = lookup.get(currentMesoscaleConfig.productId)
  const citations = [
    ...successfulResults.map((result) =>
      buildCitation(
        result.source.productId,
        result.source.label,
        result.source.url,
        result.retrievedAt,
      ),
    ),
    buildCitation(
      'spc-mesoanalysis',
      'SPC Mesoscale Analysis',
      mesoanalysisUrl,
    ),
  ]

  const highlightedProduct =
    products.find((product) => product.locationRelevance) ??
    products.find(hasActiveRisk) ??
    products[0]
  const firstRetrievedAt = successfulResults[0].retrievedAt
  const lastRetrievedAt =
    successfulResults[successfulResults.length - 1].retrievedAt
  const combinedValidRange = {
    start:
      products[0]?.validRange?.start ??
      highlightedProduct?.validRange?.start ??
      firstRetrievedAt,
    end:
      products.at(-1)?.validRange?.end ??
      highlightedProduct?.validRange?.end ??
      lastRetrievedAt,
  }

  return buildWeatherEnvelope({
    source: {
      sourceId: 'spc',
      productId: highlightedProduct?.productId ?? 'spc-convective-outlooks',
      label: 'SPC convective outlooks',
      url: highlightedProduct?.url ?? day3Config.url,
    },
    location,
    units: 'categorical',
    confidence: 0.9,
    validRange: combinedValidRange,
    summary: highlightedProduct
      ? `${highlightedProduct.title}: ${buildProductSummary(highlightedProduct)}`
      : `SPC severe-weather outlook context for ${location.name}.`,
    thumbnailUrl: highlightedProduct?.imageUrl,
    imageAlt: highlightedProduct
      ? `${highlightedProduct.title} outlook graphic`
      : 'SPC convective outlook graphic',
    data: {
      products: products.map((product) => ({
        ...product,
        summary: buildProductSummary(product),
      })),
      watchContext: watchPage
        ? parseWatchContext(htmlToPlainText(watchPage.value))
        : 'Current convective watch status is temporarily unavailable from SPC.',
      watchUrl: currentWatchesConfig.url,
      mesoscaleContext: mesoscalePage
        ? parseMesoscaleContext(htmlToPlainText(mesoscalePage.value))
        : 'Current mesoscale discussion status is temporarily unavailable from SPC.',
      mesoscaleUrl: currentMesoscaleConfig.url,
      mesoanalysisUrl,
    },
    citations,
  })
}
