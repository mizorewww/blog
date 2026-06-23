import { describe, expect, it } from 'vitest'
import { getCommitHash, getLatestPostGitCommit, getPostGitCommits } from '@/lib/postGit'

describe('post git helpers', () => {
  it('filters commits without hashes', () => {
    expect(
      getPostGitCommits([
        { subject: 'missing hash' },
        { hash: '1234567890abcdef', subject: 'full hash' },
        { shortHash: 'abc1234', subject: 'short hash' },
      ])
    ).toHaveLength(2)
  })

  it('uses short hash when present and falls back to a seven-character hash', () => {
    expect(getCommitHash({ shortHash: 'abc1234', hash: '1234567890abcdef' })).toBe('abc1234')
    expect(getCommitHash({ hash: '1234567890abcdef' })).toBe('1234567')
  })

  it('returns the newest commit from contentlayer history', () => {
    const latest = getLatestPostGitCommit({
      gitCommits: [
        { shortHash: 'newest', subject: 'new' },
        { shortHash: 'older', subject: 'old' },
      ],
    })

    expect(latest?.shortHash).toBe('newest')
  })
})
