import { describe, expect, it } from 'vitest'
import { getRepoSourceFilePathCandidates } from '../../contentlayer/config/gitHistory'

describe('git history path candidates', () => {
  it('keeps the current topic path and the retired flat blog path', () => {
    expect(
      getRepoSourceFilePathCandidates('content/blog/zh/hardware/xiaomi-book-pro-14.md')
    ).toEqual([
      'content/blog/zh/hardware/xiaomi-book-pro-14.md',
      'content/blog/zh/xiaomi-book-pro-14.md',
      'data/blog/zh/hardware/xiaomi-book-pro-14.md',
      'data/blog/zh/xiaomi-book-pro-14.md',
    ])
  })

  it('does not invent a flat path for locale-root posts', () => {
    expect(getRepoSourceFilePathCandidates('content/blog/zh/xiaomi-book-pro-14.md')).toEqual([
      'content/blog/zh/xiaomi-book-pro-14.md',
      'data/blog/zh/xiaomi-book-pro-14.md',
    ])
  })
})
