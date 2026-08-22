import { describe, expect, it } from 'vitest'
import { getSameDocumentFragmentId } from '@/lib/articleFragment'

const articleUrl = 'https://mizore.blog/zh/hardware/xiaomi-book-pro-14/?view=full'

describe('same-document article fragments', () => {
  it('decodes a fragment on the exact current document', () => {
    expect(getSameDocumentFragmentId('#%E9%97%AE%E9%A2%98%E4%B8%80', articleUrl)).toBe('问题一')
    expect(getSameDocumentFragmentId(`${articleUrl}#footnote-1`, articleUrl)).toBe('footnote-1')
  })

  it.each([
    'https://example.com/zh/hardware/xiaomi-book-pro-14/?view=full#heading',
    'https://mizore.blog/zh/another-post/?view=full#heading',
    'https://mizore.blog/zh/hardware/xiaomi-book-pro-14/?view=summary#heading',
    'https://mizore.blog/zh/hardware/xiaomi-book-pro-14/?view=full',
  ])('rejects a fragment outside the exact current document: %s', (href) => {
    expect(getSameDocumentFragmentId(href, articleUrl)).toBeNull()
  })

  it('rejects malformed fragment encoding without throwing', () => {
    expect(getSameDocumentFragmentId('#%E0%A4%A', articleUrl)).toBeNull()
  })
})
