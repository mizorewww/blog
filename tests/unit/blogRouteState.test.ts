import { describe, expect, it } from 'vitest'
import { isBlogPostPath, isHomePath, normalizePathname } from '@/lib/blogRouteState'

describe('blog route helpers', () => {
  it('normalizes leading and trailing slashes', () => {
    expect(normalizePathname('zh/post/')).toBe('/zh/post')
    expect(normalizePathname('/')).toBe('/')
  })

  it('detects root and localized home paths', () => {
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/zh/')).toBe(true)
    expect(isHomePath('/en')).toBe(true)
    expect(isHomePath('/zh/post')).toBe(false)
  })

  it('classifies only localized article paths as posts', () => {
    expect(isBlogPostPath('/zh/example/')).toBe(true)
    expect(isBlogPostPath('/en/nested/example/')).toBe(true)
    expect(isBlogPostPath('/example/')).toBe(false)
    expect(isBlogPostPath('/ja/example/')).toBe(false)
  })

  it('excludes home, term, and search routes', () => {
    expect(isBlogPostPath('/zh/')).toBe(false)
    expect(isBlogPostPath('/zh/tags/')).toBe(false)
    expect(isBlogPostPath('/zh/tags/nextjs/')).toBe(false)
    expect(isBlogPostPath('/zh/categories/')).toBe(false)
    expect(isBlogPostPath('/zh/categories/linux/')).toBe(false)
    expect(isBlogPostPath('/zh/search/')).toBe(false)
  })
})
