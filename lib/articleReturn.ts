import { isBlogPostPath, normalizePathname } from '@/lib/blogRouteState'
import { isLocale, type Locale } from '@/lib/i18n'

export const ARTICLE_RETURN_MARKER_KEY = 'mizore:article-return'
export const ARTICLE_RETURN_ARRIVAL_MAX_AGE_MS = 15 * 1000

export type ArticleReturnMarker = {
  sourceUrl: string
  targetUrl: string
  createdAt: number
}

type ArticleReturnArrivalContext = {
  currentUrl: string
  documentStartedAt: number
  now: number
}

type ArticleReturnStorage = {
  getItem(key: string): string | null
  removeItem(key: string): void
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function getPathLocale(pathname: string): Locale | null {
  const segment = normalizePathname(pathname).split('/')[1]

  return isLocale(segment) ? segment : null
}

function isSupportedListSourcePath(pathname: string) {
  const normalized = normalizePathname(pathname)
  const locale = getPathLocale(normalized)

  if (!locale) {
    return false
  }

  const localizedHome = `/${locale}`

  return (
    normalized === localizedHome ||
    normalized === `${localizedHome}/search` ||
    new RegExp(`^/${locale}/(?:categories|tags)/[^/]+$`).test(normalized)
  )
}

function markerRoutesAreValid(marker: ArticleReturnMarker) {
  const source = parseHttpUrl(marker.sourceUrl)
  const target = parseHttpUrl(marker.targetUrl)

  if (!source || !target || source.origin !== target.origin) {
    return false
  }

  const sourceLocale = getPathLocale(source.pathname)
  const targetLocale = getPathLocale(target.pathname)

  return (
    sourceLocale !== null &&
    sourceLocale === targetLocale &&
    isSupportedListSourcePath(source.pathname) &&
    isBlogPostPath(target.pathname)
  )
}

export function createArticleReturnMarker(input: ArticleReturnMarker): ArticleReturnMarker | null {
  if (!Number.isFinite(input.createdAt)) {
    return null
  }

  const marker = { ...input }

  return markerRoutesAreValid(marker) ? marker : null
}

export function parseArticleReturnMarker(value: string | null): ArticleReturnMarker | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<ArticleReturnMarker>

    if (
      typeof parsed.sourceUrl !== 'string' ||
      typeof parsed.targetUrl !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null
    }

    return createArticleReturnMarker({
      sourceUrl: parsed.sourceUrl,
      targetUrl: parsed.targetUrl,
      createdAt: parsed.createdAt,
    })
  } catch {
    return null
  }
}

function isProvenArticleArrival(marker: ArticleReturnMarker, context: ArticleReturnArrivalContext) {
  const target = parseHttpUrl(marker.targetUrl)
  const current = parseHttpUrl(context.currentUrl)
  const age = context.now - marker.createdAt

  return (
    markerRoutesAreValid(marker) &&
    target !== null &&
    current !== null &&
    target.href === current.href &&
    marker.createdAt >= context.documentStartedAt &&
    age >= 0 &&
    age <= ARTICLE_RETURN_ARRIVAL_MAX_AGE_MS
  )
}

export function consumeArticleReturnMarker(
  storage: ArticleReturnStorage,
  context: ArticleReturnArrivalContext
) {
  let value: string | null

  try {
    value = storage.getItem(ARTICLE_RETURN_MARKER_KEY)
    storage.removeItem(ARTICLE_RETURN_MARKER_KEY)
  } catch {
    return false
  }

  const marker = parseArticleReturnMarker(value)

  return marker !== null && isProvenArticleArrival(marker, context)
}
