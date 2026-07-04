import { describe, expect, it } from 'vitest'
import {
  defaultLocale,
  getLocaleFromPathname,
  isLocale,
  localizePath,
  stripLocaleFromPathname,
  switchLocalePathForSection,
  withTrailingSlash,
} from '@/lib/i18n'

describe('isLocale', () => {
  it('narrows to the configured locale union', () => {
    expect(isLocale('zh')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('ja')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
})

describe('getLocaleFromPathname', () => {
  it('returns the locale segment or the default', () => {
    expect(getLocaleFromPathname('/zh/tags/blog/')).toBe('zh')
    expect(getLocaleFromPathname('/en/')).toBe('en')
    expect(getLocaleFromPathname('/unknown/')).toBe(defaultLocale)
    expect(getLocaleFromPathname('/')).toBe(defaultLocale)
  })
})

describe('withTrailingSlash', () => {
  it('keeps the root and appends a slash otherwise', () => {
    expect(withTrailingSlash('/')).toBe('/')
    expect(withTrailingSlash('/zh/tags')).toBe('/zh/tags/')
    expect(withTrailingSlash('/zh/tags/')).toBe('/zh/tags/')
  })
})

describe('stripLocaleFromPathname', () => {
  it('removes the leading locale segment and trailing slash', () => {
    expect(stripLocaleFromPathname('/zh/tags/blog/')).toBe('/tags/blog')
    expect(stripLocaleFromPathname('/en/')).toBe('/')
    expect(stripLocaleFromPathname('/no-locale/page/')).toBe('/no-locale/page/')
  })
})

describe('localizePath', () => {
  it('replaces the locale prefix and normalizes the trailing slash', () => {
    expect(localizePath('/tags/blog', 'en')).toBe('/en/tags/blog/')
    expect(localizePath('/', 'en')).toBe('/en/')
    expect(localizePath('/zh/tags/blog/', 'en')).toBe('/en/tags/blog/')
  })
})

describe('switchLocalePathForSection', () => {
  it('collapses a term page to its section index when switching locale', () => {
    expect(switchLocalePathForSection('/zh/categories/blog/', 'en')).toBe('/en/categories/')
    expect(switchLocalePathForSection('/zh/tags/blog/', 'en')).toBe('/en/tags/')
  })

  it('switches the locale for non-term paths', () => {
    expect(switchLocalePathForSection('/zh/some-post/', 'en')).toBe('/en/some-post/')
  })
})
