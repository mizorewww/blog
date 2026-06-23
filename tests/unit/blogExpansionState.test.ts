import { describe, expect, it } from 'vitest'
import { getInitialVisibleCount, POSTS_PER_BATCH } from '@/lib/blogExpansionState'
import type { BlogListPost } from '@/lib/listPosts'

function post(path: string): BlogListPost {
  return {
    title: path,
    date: '2026-01-01',
    categories: [],
    tags: [],
    slug: path,
    locale: 'zh',
    path,
    readingTime: { text: '', minutes: 1, time: 1, words: 1 },
    gitUpdatedAt: '',
    gitCommits: [],
    gitCommitCount: 0,
    githubUrl: '',
  }
}

describe('blog expansion state', () => {
  it('keeps the target post visible when restoring a later list item', () => {
    const posts = Array.from({ length: POSTS_PER_BATCH + 3 }, (_, index) =>
      post(`zh/post-${index}`)
    )
    const targetPath = posts[POSTS_PER_BATCH + 1]?.path

    expect(getInitialVisibleCount(posts, 0, targetPath)).toBe(POSTS_PER_BATCH + 2)
  })
})
