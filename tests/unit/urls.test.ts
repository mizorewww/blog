import { describe, expect, it } from 'vitest'
import { absoluteSiteUrl, decodeRouteParam } from '@/lib/urls'

describe('url helpers', () => {
  it('normalizes absolute site urls with trailing slash', () => {
    expect(absoluteSiteUrl('https://mizore.blog', 'zh/post')).toBe('https://mizore.blog/zh/post/')
  })

  it('decodes nested route params defensively', () => {
    expect(decodeRouteParam('%25E6%258A%2598%25E8%2585%25BE')).toBe('折腾')
    expect(decodeRouteParam('%E0%A4%A')).toBe('%E0%A4%A')
  })
})
