import { isLocale, locales } from '@/lib/i18n'

export function normalizePathname(pathname: string) {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const withoutTrailingSlash = normalized.replace(/\/+$/, '')

  return withoutTrailingSlash || '/'
}

export function isHomePath(pathname: string) {
  const currentPath = normalizePathname(pathname)

  return currentPath === '/' || locales.some((locale) => currentPath === `/${locale}`)
}

export function isBlogPostPath(pathname: string) {
  const segments = normalizePathname(pathname).split('/').filter(Boolean)

  if (segments.length < 2 || !isLocale(segments[0])) {
    return false
  }

  return !['categories', 'tags', 'search'].includes(segments[1])
}
