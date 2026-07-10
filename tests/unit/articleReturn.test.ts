import { describe, expect, it } from 'vitest'
import {
  ARTICLE_RETURN_ARRIVAL_MAX_AGE_MS,
  ARTICLE_RETURN_MARKER_KEY,
  consumeArticleReturnMarker,
  createArticleReturnMarker,
  parseArticleReturnMarker,
  type ArticleReturnMarker,
} from '@/lib/articleReturn'

const now = 1_800_000
const baseMarker: ArticleReturnMarker = {
  sourceUrl: 'https://mizore.blog/zh/',
  targetUrl: 'https://mizore.blog/zh/xiaomi-book-pro-14/',
  createdAt: now,
}

function createMemoryStorage(value: string | null) {
  let storedValue = value
  let removals = 0

  return {
    storage: {
      getItem(key: string) {
        return key === ARTICLE_RETURN_MARKER_KEY ? storedValue : null
      },
      removeItem(key: string) {
        if (key === ARTICLE_RETURN_MARKER_KEY) {
          storedValue = null
          removals += 1
        }
      },
    },
    get removals() {
      return removals
    },
    get value() {
      return storedValue
    },
  }
}

function consumeMarker(
  marker: ArticleReturnMarker = baseMarker,
  overrides: Partial<{
    currentUrl: string
    documentStartedAt: number
    now: number
  }> = {}
) {
  const memory = createMemoryStorage(JSON.stringify(marker))
  const result = consumeArticleReturnMarker(memory.storage, {
    currentUrl: marker.targetUrl,
    documentStartedAt: 0,
    now,
    ...overrides,
  })

  return { memory, result }
}

describe('article return marker creation', () => {
  it.each([
    'https://mizore.blog/zh/',
    'https://mizore.blog/zh/categories/%E6%8A%98%E8%85%BE/',
    'https://mizore.blog/zh/tags/linux/',
    'https://mizore.blog/zh/search/?q=linux',
  ])('accepts a supported same-locale list source: %s', (sourceUrl) => {
    expect(createArticleReturnMarker({ ...baseMarker, sourceUrl })).toEqual({
      ...baseMarker,
      sourceUrl,
    })
  })

  it.each([
    'https://mizore.blog/zh/tags/',
    'https://mizore.blog/zh/categories/',
    'https://mizore.blog/zh/xiaomi-book-pro-14/',
  ])('rejects a non-list source: %s', (sourceUrl) => {
    expect(createArticleReturnMarker({ ...baseMarker, sourceUrl })).toBeNull()
  })

  it('rejects cross-origin and cross-locale targets', () => {
    expect(
      createArticleReturnMarker({
        ...baseMarker,
        targetUrl: 'https://example.com/zh/xiaomi-book-pro-14/',
      })
    ).toBeNull()
    expect(
      createArticleReturnMarker({
        ...baseMarker,
        targetUrl: 'https://mizore.blog/en/xiaomi-book-pro-14/',
      })
    ).toBeNull()
  })

  it('rejects reserved targets and invalid timestamps', () => {
    expect(
      createArticleReturnMarker({ ...baseMarker, targetUrl: 'https://mizore.blog/zh/search/' })
    ).toBeNull()
    expect(createArticleReturnMarker({ ...baseMarker, createdAt: Number.NaN })).toBeNull()
  })
})

describe('article return marker consumption', () => {
  it('consumes a fresh exact arrival once without relying on history length', () => {
    const memory = createMemoryStorage(JSON.stringify(baseMarker))
    const context = {
      currentUrl: baseMarker.targetUrl,
      documentStartedAt: now - 1_000,
      now,
    }

    expect(consumeArticleReturnMarker(memory.storage, context)).toBe(true)
    expect(memory.value).toBeNull()
    expect(memory.removals).toBe(1)
    expect(consumeArticleReturnMarker(memory.storage, context)).toBe(false)
    expect(memory.removals).toBe(2)
  })

  it('rejects and clears a marker for a different article', () => {
    const { memory, result } = consumeMarker(baseMarker, {
      currentUrl: 'https://mizore.blog/zh/another-post/',
    })

    expect(result).toBe(false)
    expect(memory.value).toBeNull()
    expect(memory.removals).toBe(1)
  })

  it('rejects markers from before the current document time origin', () => {
    const { memory, result } = consumeMarker(baseMarker, { documentStartedAt: now + 1 })

    expect(result).toBe(false)
    expect(memory.value).toBeNull()
  })

  it('rejects expired and future arrivals', () => {
    expect(
      consumeMarker(baseMarker, { now: now + ARTICLE_RETURN_ARRIVAL_MAX_AGE_MS + 1 }).result
    ).toBe(false)
    expect(consumeMarker(baseMarker, { now: now - 1 }).result).toBe(false)
  })

  it('clears malformed storage while falling back safely', () => {
    const memory = createMemoryStorage('{broken')

    expect(
      consumeArticleReturnMarker(memory.storage, {
        currentUrl: baseMarker.targetUrl,
        documentStartedAt: 0,
        now,
      })
    ).toBe(false)
    expect(memory.value).toBeNull()
  })
})

describe('article return marker parsing', () => {
  it('parses a valid marker without history, scroll, or animation state', () => {
    const parsed = parseArticleReturnMarker(JSON.stringify(baseMarker))

    expect(parsed).toEqual(baseMarker)
    expect(Object.keys(parsed || {})).toEqual(['sourceUrl', 'targetUrl', 'createdAt'])
  })

  it.each([null, '', '{broken', '{}', JSON.stringify({ ...baseMarker, createdAt: 'now' })])(
    'returns null for malformed storage: %s',
    (value) => {
      expect(parseArticleReturnMarker(value)).toBeNull()
    }
  )
})
