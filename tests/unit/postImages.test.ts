import { describe, expect, it } from 'vitest'
import { getPostImageUrls, toAbsoluteUrl } from '@/lib/postImages'

const siteUrl = 'https://mizore.blog'

describe('toAbsoluteUrl', () => {
  it('passes through http(s) urls unchanged', () => {
    expect(toAbsoluteUrl('https://example.com/x.png', siteUrl)).toBe('https://example.com/x.png')
  })

  it('resolves relative urls against the site url', () => {
    expect(toAbsoluteUrl('/static/images/a.png', siteUrl)).toBe(
      'https://mizore.blog/static/images/a.png'
    )
  })
})

describe('getPostImageUrls', () => {
  it('dedupes image and images entries', () => {
    const urls = getPostImageUrls({
      image: '/static/images/a.png',
      images: ['/static/images/a.png', '/static/images/b.png'],
      siteUrl,
    })
    expect(urls).toEqual([
      'https://mizore.blog/static/images/a.png',
      'https://mizore.blog/static/images/b.png',
    ])
  })

  it('falls back to the provided fallback when no images are present', () => {
    expect(
      getPostImageUrls({ image: null, images: undefined, fallback: '/static/banner.png', siteUrl })
    ).toEqual(['https://mizore.blog/static/banner.png'])
  })

  it('returns an empty array when nothing is available', () => {
    expect(getPostImageUrls({ siteUrl })).toEqual([])
  })

  it('keeps remote urls absolute', () => {
    expect(getPostImageUrls({ image: 'https://cdn.example.com/cover.png', siteUrl })).toEqual([
      'https://cdn.example.com/cover.png',
    ])
  })
})
