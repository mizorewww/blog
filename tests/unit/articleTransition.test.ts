import { describe, expect, it } from 'vitest'
import {
  articleTransitionReducer,
  createArticleCardSnapshot,
  createArticleTransitionTarget,
  deriveArticleTransitionDestinationStage,
  getArticleTransitionDestination,
  idleArticleTransitionState,
  type ArticleCardSnapshot,
  type ArticleTransitionRect,
} from '@/lib/articleTransition'

const viewport = { width: 1440, height: 900 }
const cardRect: ArticleTransitionRect = { top: 180, left: 430, width: 580, height: 360 }
const coverRect: ArticleTransitionRect = { top: 180, left: 430, width: 580, height: 219 }

const snapshot: ArticleCardSnapshot = {
  key: 'zh/xiaomi-book-pro-14',
  sourcePath: '/zh/categories/%E6%8A%98%E8%85%BE',
  targetPath: '/zh/xiaomi-book-pro-14',
  imageSrc: 'https://mizore.blog/static/images/xiaomi.webp',
  title: 'Xiaomi Book Pro 14',
  gitUpdated: '更新于 2026年5月10日 (2个月前)',
  gitSource: '查看源文',
  summary: 'Linux notes',
  publishedDate: '2026年5月10日',
  primaryTag: 'Linux',
  readMore: '继续阅读',
  cardRect,
  coverRect,
  radius: 8,
}

describe('article transition geometry', () => {
  it.each([
    [
      { width: 320, height: 720 },
      { top: 72, left: 0, width: 320, height: 648, radius: 0 },
    ],
    [
      { width: 390, height: 844 },
      { top: 72, left: 0, width: 390, height: 772, radius: 0 },
    ],
    [
      { width: 768, height: 900 },
      { top: 120, left: 15, width: 738, height: 780, radius: 8 },
    ],
    [
      { width: 1440, height: 900 },
      { top: 120, left: 307, width: 1118, height: 780, radius: 8 },
    ],
  ])('creates the reading-surface destination for %o', (input, expected) => {
    expect(getArticleTransitionDestination(input)).toEqual(expected)
  })

  it('rejects invalid viewports', () => {
    expect(getArticleTransitionDestination({ width: 319, height: 720 })).toBeNull()
    expect(getArticleTransitionDestination({ width: 390, height: 72 })).toBeNull()
    expect(getArticleTransitionDestination({ width: Number.NaN, height: 720 })).toBeNull()
  })
})

describe('article transition snapshots', () => {
  it('accepts bounded structured card data without DOM or article content', () => {
    expect(createArticleCardSnapshot(snapshot, viewport)).toEqual(snapshot)
  })

  it('normalizes local paths and whitespace', () => {
    expect(
      createArticleCardSnapshot(
        {
          ...snapshot,
          sourcePath: '/zh/',
          targetPath: '/zh/xiaomi-book-pro-14/',
          title: '  Xiaomi   Book  ',
        },
        viewport
      )
    ).toMatchObject({
      sourcePath: '/zh',
      targetPath: '/zh/xiaomi-book-pro-14',
      title: 'Xiaomi Book',
    })
  })

  it('rejects hidden, malformed, oversized, and out-of-card data', () => {
    expect(
      createArticleCardSnapshot(
        { ...snapshot, cardRect: { ...cardRect, top: viewport.height + 1 } },
        viewport
      )
    ).toBeNull()
    expect(createArticleCardSnapshot({ ...snapshot, title: '' }, viewport)).toBeNull()
    expect(createArticleCardSnapshot({ ...snapshot, title: 'x'.repeat(241) }, viewport)).toBeNull()
    expect(createArticleCardSnapshot({ ...snapshot, publishedDate: '' }, viewport)).toBeNull()
    expect(createArticleCardSnapshot({ ...snapshot, readMore: '' }, viewport)).toBeNull()
    expect(
      createArticleCardSnapshot({ ...snapshot, imageSrc: 'javascript:bad' }, viewport)
    ).toBeNull()
    expect(
      createArticleCardSnapshot(
        { ...snapshot, coverRect: { ...coverRect, left: cardRect.left - 3 } },
        viewport
      )
    ).toBeNull()
  })

  it('rejects zero-area full-card geometry instead of creating a visual snapshot', () => {
    expect(
      createArticleCardSnapshot({ ...snapshot, coverRect: { ...coverRect, width: 0 } }, viewport)
    ).toBeNull()
    expect(
      createArticleCardSnapshot({ ...snapshot, cardRect: { ...cardRect, height: 0 } }, viewport)
    ).toBeNull()
  })

  it('validates a visible return target', () => {
    expect(createArticleTransitionTarget({ cardRect, coverRect, radius: 8 }, viewport)).toEqual({
      cardRect,
      coverRect,
      radius: 8,
    })
    expect(
      createArticleTransitionTarget(
        { cardRect: { ...cardRect, top: 901 }, coverRect: { ...coverRect, top: 901 }, radius: 8 },
        viewport
      )
    ).toBeNull()
  })
})

describe('article transition state reducer', () => {
  it('retains the snapshot only after route and motion complete in either order', () => {
    const opening = articleTransitionReducer(idleArticleTransitionState, {
      type: 'open-started',
      snapshot,
      viewport,
      reducedMotion: false,
    })

    const routeFirst = articleTransitionReducer(opening, {
      type: 'route-committed',
      pathname: snapshot.targetPath,
    })
    expect(routeFirst).toMatchObject({
      phase: 'opening',
      routeCommitted: true,
      motionCompleted: false,
    })
    expect(articleTransitionReducer(routeFirst, { type: 'open-motion-completed' }).phase).toBe(
      'retained'
    )

    const motionFirst = articleTransitionReducer(opening, { type: 'open-motion-completed' })
    expect(motionFirst).toMatchObject({
      phase: 'opening',
      routeCommitted: false,
      motionCompleted: true,
    })
    expect(
      articleTransitionReducer(motionFirst, {
        type: 'route-committed',
        pathname: snapshot.targetPath,
      }).phase
    ).toBe('retained')
  })

  it('waits for the proven source target before returning', () => {
    const opening = articleTransitionReducer(idleArticleTransitionState, {
      type: 'open-started',
      snapshot,
      viewport,
      reducedMotion: false,
    })
    const committed = articleTransitionReducer(opening, {
      type: 'route-committed',
      pathname: snapshot.targetPath,
    })
    const retained = articleTransitionReducer(committed, { type: 'open-motion-completed' })
    const waiting = articleTransitionReducer(retained, { type: 'return-requested' })

    expect(waiting.phase).toBe('return-waiting')

    const returning = articleTransitionReducer(waiting, {
      type: 'return-target-resolved',
      pathname: snapshot.sourcePath,
      target: { cardRect, coverRect, radius: 8 },
    })

    expect(returning.phase).toBe('returning')
    expect(articleTransitionReducer(returning, { type: 'return-motion-completed' })).toEqual(
      idleArticleTransitionState
    )
  })

  it.each([
    { type: 'cancelled' as const },
    { type: 'viewport-changed' as const },
    { type: 'route-committed' as const, pathname: '/zh/search' },
  ])('cancels ambiguous transition state for $type', (action) => {
    const opening = articleTransitionReducer(idleArticleTransitionState, {
      type: 'open-started',
      snapshot,
      viewport,
      reducedMotion: true,
    })

    expect(articleTransitionReducer(opening, action)).toEqual(idleArticleTransitionState)
  })
})

describe('article transition destination presentation', () => {
  const opening = articleTransitionReducer(idleArticleTransitionState, {
    type: 'open-started',
    snapshot,
    viewport,
    reducedMotion: false,
  })

  it('conceals the committed destination synchronously until opening motion completes', () => {
    expect(deriveArticleTransitionDestinationStage(opening, snapshot.sourcePath)).toBeNull()
    expect(deriveArticleTransitionDestinationStage(opening, snapshot.targetPath)).toBe('opening')

    const motionCompleted = articleTransitionReducer(opening, {
      type: 'open-motion-completed',
    })
    expect(deriveArticleTransitionDestinationStage(motionCompleted, snapshot.targetPath)).toBe(
      'opening'
    )

    const retained = articleTransitionReducer(motionCompleted, {
      type: 'route-committed',
      pathname: snapshot.targetPath,
    })
    expect(deriveArticleTransitionDestinationStage(retained, snapshot.targetPath)).toBe('revealed')
  })

  it('does not stage ambiguous, returning, or reduced-motion destinations', () => {
    const reducedOpening = articleTransitionReducer(idleArticleTransitionState, {
      type: 'open-started',
      snapshot,
      viewport,
      reducedMotion: true,
    })
    const routeCommitted = articleTransitionReducer(opening, {
      type: 'route-committed',
      pathname: snapshot.targetPath,
    })
    const retained = articleTransitionReducer(routeCommitted, {
      type: 'open-motion-completed',
    })
    const returning = articleTransitionReducer(retained, { type: 'return-requested' })

    expect(
      deriveArticleTransitionDestinationStage(idleArticleTransitionState, snapshot.targetPath)
    ).toBeNull()
    expect(deriveArticleTransitionDestinationStage(opening, '/zh/search')).toBeNull()
    expect(deriveArticleTransitionDestinationStage(reducedOpening, snapshot.targetPath)).toBeNull()
    expect(deriveArticleTransitionDestinationStage(returning, snapshot.targetPath)).toBeNull()
  })
})
