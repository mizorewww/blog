import { describe, expect, it } from 'vitest'
import { isBlogPostPath, isHomePath, normalizePathname } from '@/lib/blogRouteState'

describe('blog route state helpers', () => {
  it('normalizes trailing slashes and missing leading slash', () => {
    expect(normalizePathname('zh/post/')).toBe('/zh/post')
    expect(normalizePathname('/')).toBe('/')
  })

  it('detects localized home paths', () => {
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/zh/')).toBe(true)
    expect(isHomePath('/en')).toBe(true)
    expect(isHomePath('/zh/post')).toBe(false)
  })

  it('excludes term routes from blog post paths', () => {
    expect(isBlogPostPath('/zh/example')).toBe(true)
    expect(isBlogPostPath('/zh/tags')).toBe(false)
    expect(isBlogPostPath('/zh/tags/nextjs')).toBe(false)
    expect(isBlogPostPath('/zh/categories/折腾')).toBe(false)
  })
})
