import { describe, expect, it } from 'vitest'
import { getPostModifiedDate, getPostPublishedDate, latestDate } from '@/lib/postDates'

describe('getPostPublishedDate', () => {
  it('returns the published date verbatim', () => {
    expect(getPostPublishedDate({ date: '2026-01-02' })).toBe('2026-01-02')
  })
})

describe('getPostModifiedDate', () => {
  it('prefers git updatedAt, then lastmod, then date', () => {
    expect(getPostModifiedDate({ date: '2026-01-01', gitUpdatedAt: '2026-02-01' })).toBe(
      '2026-02-01'
    )
    expect(getPostModifiedDate({ date: '2026-01-01', lastmod: '2026-01-15' })).toBe('2026-01-15')
    expect(getPostModifiedDate({ date: '2026-01-01' })).toBe('2026-01-01')
  })
})

describe('latestDate', () => {
  it('returns the most recent date', () => {
    expect(latestDate(['2026-01-01', '2026-03-01', '2026-02-01'])).toBe('2026-03-01')
  })

  it('ignores empty values', () => {
    expect(latestDate(['', '2026-01-01', ''])).toBe('2026-01-01')
  })

  it('returns undefined for an empty input', () => {
    expect(latestDate([])).toBeUndefined()
    expect(latestDate(['', ''])).toBeUndefined()
  })
})
