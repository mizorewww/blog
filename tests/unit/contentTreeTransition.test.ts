import { describe, expect, it } from 'vitest'
import {
  ARTICLE_TRANSITION_OPEN_DURATION_SECONDS,
  ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS,
  ARTICLE_TRANSITION_RETURN_DURATION_SECONDS,
} from '@/lib/articleTransition'
import {
  articleSurfaceVeilReducer,
  contentTreeTransitionReducer,
  createContentTreeSnapshot,
  getArticleSurfaceVeilRect,
  getContentTreeDestination,
  getContentTreeSlideDuration,
  idleArticleSurfaceVeilState,
  idleContentTreeTransitionState,
} from '@/lib/contentTreeTransition'

const viewport = { width: 1440, height: 900 }
const sourceRect = { top: 160, left: 1100, width: 256, height: 420 }
const nodes = [
  {
    kind: 'folder' as const,
    name: 'hardware',
    path: 'hardware',
    children: [
      {
        kind: 'post' as const,
        title: 'Xiaomi Book',
        slug: 'hardware/xiaomi-book-pro-14',
        path: 'zh/hardware/xiaomi-book-pro-14',
      },
    ],
  },
]

const snapshot = {
  sourcePath: '/zh',
  targetPath: '/zh/hardware/xiaomi-book-pro-14',
  nodes,
  sourceRect,
  chrome: 'sidebar' as const,
  openFolderPaths: ['hardware'],
}

describe('content tree destination geometry', () => {
  it('places the article rail at desktop widths', () => {
    expect(getContentTreeDestination(viewport)).toEqual({
      top: 120,
      left: 1169,
      width: 256,
      height: 764,
      radius: 8,
    })
  })

  it('hides the article rail below 1024px', () => {
    expect(getContentTreeDestination({ width: 1023, height: 900 })).toBeNull()
    expect(getContentTreeDestination({ width: 319, height: 720 })).toBeNull()
  })
})

describe('content tree snapshots', () => {
  it('accepts a compact on-page tree and visible source rect', () => {
    expect(createContentTreeSnapshot(snapshot, viewport)).toEqual(snapshot)
  })

  it('rejects hidden, empty, or body-bearing trees', () => {
    expect(
      createContentTreeSnapshot({ ...snapshot, sourceRect: { ...sourceRect, top: 901 } }, viewport)
    ).toBeNull()
    expect(createContentTreeSnapshot({ ...snapshot, nodes: [] }, viewport)).toBeNull()
    expect(
      createContentTreeSnapshot(
        {
          ...snapshot,
          nodes: [
            {
              kind: 'post',
              title: 'Xiaomi Book',
              slug: 'hardware/xiaomi-book-pro-14',
              path: 'zh/hardware/xiaomi-book-pro-14',
              body: '# no',
            } as never,
          ],
        },
        viewport
      )
    ).toBeNull()
  })

  it('persists source chrome and the currently open folders', () => {
    expect(
      createContentTreeSnapshot(
        { ...snapshot, chrome: 'rail', openFolderPaths: ['hardware'] },
        viewport
      )
    ).toEqual({
      ...snapshot,
      chrome: 'rail',
      openFolderPaths: ['hardware'],
    })
    expect(createContentTreeSnapshot({ ...snapshot, openFolderPaths: [] }, viewport)).toEqual({
      ...snapshot,
      openFolderPaths: [],
    })
  })

  it('rejects missing chrome or folders that are not in the snapshot tree', () => {
    expect(createContentTreeSnapshot({ ...snapshot, chrome: undefined }, viewport)).toBeNull()
    expect(createContentTreeSnapshot({ ...snapshot, chrome: 'card' as never }, viewport)).toBeNull()
    expect(
      createContentTreeSnapshot({ ...snapshot, openFolderPaths: undefined }, viewport)
    ).toBeNull()
    expect(
      createContentTreeSnapshot({ ...snapshot, openFolderPaths: ['missing'] }, viewport)
    ).toBeNull()
  })
})

describe('content tree transition reducer', () => {
  it('opens only when a desktop destination exists', () => {
    const opening = contentTreeTransitionReducer(idleContentTreeTransitionState, {
      type: 'open-started',
      snapshot,
      viewport,
      reducedMotion: false,
    })

    expect(opening).toMatchObject({
      phase: 'opening',
      destination: { left: 1169, width: 256 },
    })
    expect(
      contentTreeTransitionReducer(idleContentTreeTransitionState, {
        type: 'open-started',
        snapshot,
        viewport: { width: 800, height: 900 },
        reducedMotion: false,
      })
    ).toEqual(idleContentTreeTransitionState)
  })
})

describe('content tree slide duration', () => {
  it('uses the card return clock for a companion return', () => {
    expect(
      getContentTreeSlideDuration({
        phase: 'returning',
        companion: true,
        reducedMotion: false,
      })
    ).toBe(ARTICLE_TRANSITION_RETURN_DURATION_SECONDS)
  })

  it('keeps the open clock for solo tree motion and companion opens', () => {
    expect(
      getContentTreeSlideDuration({
        phase: 'opening',
        companion: false,
        reducedMotion: false,
      })
    ).toBe(ARTICLE_TRANSITION_OPEN_DURATION_SECONDS)
    expect(
      getContentTreeSlideDuration({
        phase: 'returning',
        companion: false,
        reducedMotion: false,
      })
    ).toBe(ARTICLE_TRANSITION_OPEN_DURATION_SECONDS)
    expect(
      getContentTreeSlideDuration({
        phase: 'opening',
        companion: true,
        reducedMotion: false,
      })
    ).toBe(ARTICLE_TRANSITION_OPEN_DURATION_SECONDS)
  })

  it('collapses to the reduced-motion hint', () => {
    expect(
      getContentTreeSlideDuration({
        phase: 'returning',
        companion: true,
        reducedMotion: true,
      })
    ).toBe(ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS)
    expect(
      getContentTreeSlideDuration({
        phase: 'opening',
        companion: false,
        reducedMotion: true,
      })
    ).toBe(ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS)
  })
})

describe('article surface veil', () => {
  it('reuses the article destination rect and skips reduced motion', () => {
    expect(getArticleSurfaceVeilRect(viewport)).toEqual({
      top: 120,
      left: 307,
      width: 826,
      height: 780,
    })

    expect(
      articleSurfaceVeilReducer(idleArticleSurfaceVeilState, {
        type: 'cover-started',
        targetPath: snapshot.targetPath,
        rect: sourceRect,
        reducedMotion: true,
      })
    ).toEqual(idleArticleSurfaceVeilState)

    const covering = articleSurfaceVeilReducer(idleArticleSurfaceVeilState, {
      type: 'cover-started',
      targetPath: snapshot.targetPath,
      rect: sourceRect,
      reducedMotion: false,
    })
    expect(covering.phase).toBe('covering')
    expect(
      articleSurfaceVeilReducer(covering, {
        type: 'route-committed',
        pathname: snapshot.targetPath,
      }).phase
    ).toBe('revealing')
  })
})
