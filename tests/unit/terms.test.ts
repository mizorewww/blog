import { describe, expect, it } from 'vitest'
import {
  getPostsByTerm,
  getTagCounts,
  getTermKeys,
  getTermSummaries,
  termSlug,
} from '@/lib/content/terms'

const posts = [
  { tags: ['Next.js', 'Blog'], categories: ['折腾'] },
  { tags: ['Next.js', 'Linux'], categories: ['折腾'] },
]

describe('term helpers', () => {
  it('preserves display labels while using slugs as route keys', () => {
    const summaries = getTagCounts(posts)

    expect(termSlug('Next.js')).toBe('nextjs')
    expect(summaries.nextjs).toEqual({ slug: 'nextjs', label: 'Next.js', count: 2 })
    expect(summaries.blog).toEqual({ slug: 'blog', label: 'Blog', count: 1 })
  })

  it('sorts summaries by count and then label', () => {
    expect(getTermSummaries(posts, 'tags').map((term) => term.label)).toEqual([
      'Next.js',
      'Blog',
      'Linux',
    ])
  })

  it('filters posts by route slug', () => {
    expect(getPostsByTerm(posts, 'tags', 'nextjs')).toHaveLength(2)
    expect(getTermKeys(getTagCounts(posts))).toEqual(['nextjs', 'blog', 'linux'])
  })
})
