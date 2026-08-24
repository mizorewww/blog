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
  findContentTreeCurrentSlug,
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

describe('findContentTreeCurrentSlug', () => {
  it('finds the slug of the post the target path points at', () => {
    expect(findContentTreeCurrentSlug(nodes, '/zh/hardware/xiaomi-book-pro-14')).toBe(
      'hardware/xiaomi-book-pro-14'
    )
  })

  it('tolerates trailing slashes and missing leading slashes', () => {
    expect(findContentTreeCurrentSlug(nodes, '/zh/hardware/xiaomi-book-pro-14/')).toBe(
      'hardware/xiaomi-book-pro-14'
    )
  })

  it('returns undefined when the target is not in the tree', () => {
    expect(findContentTreeCurrentSlug(nodes, '/zh/hardware/missing')).toBeUndefined()
    expect(findContentTreeCurrentSlug(nodes, '/zh')).toBeUndefined()
  })

  it('matches percent-encoded target paths against raw node paths', () => {
    const zhNodes = [
      {
        kind: 'folder' as const,
        name: '技术',
        path: '技术',
        children: [
          {
            kind: 'post' as const,
            title: 'Memoh',
            slug: '技术/making-memoh-cheaper-on-telegram',
            path: 'zh/技术/making-memoh-cheaper-on-telegram',
          },
        ],
      },
    ]

    expect(
      findContentTreeCurrentSlug(zhNodes, '/zh/%E6%8A%80%E6%9C%AF/making-memoh-cheaper-on-telegram')
    ).toBe('技术/making-memoh-cheaper-on-telegram')
    expect(findContentTreeCurrentSlug(zhNodes, '/zh/%E6%8A%80%E6%9C%AF/missing')).toBeUndefined()
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

  it('retargets an opening or retained session to the switched article', () => {
    const switchedPath = '/zh/hardware/another-post/'
    const switchedTarget = '/zh/hardware/another-post'
    const opening = contentTreeTransitionReducer(idleContentTreeTransitionState, {
      type: 'open-started',
      snapshot,
      viewport,
      reducedMotion: false,
    })

    expect(
      contentTreeTransitionReducer(opening, { type: 'article-switched', targetPath: switchedPath })
    ).toMatchObject({
      phase: 'opening',
      snapshot: { sourcePath: snapshot.sourcePath, targetPath: switchedTarget },
    })

    const retained = contentTreeTransitionReducer(
      contentTreeTransitionReducer(opening, {
        type: 'route-committed',
        pathname: snapshot.targetPath,
      }),
      { type: 'open-motion-completed' }
    )
    const retargeted = contentTreeTransitionReducer(retained, {
      type: 'article-switched',
      targetPath: switchedPath,
    })

    expect(retargeted).toMatchObject({
      phase: 'retained',
      snapshot: { sourcePath: snapshot.sourcePath, targetPath: switchedTarget },
    })

    // The retargeted session still runs the normal close sequence back to the
    // original sidebar source.
    const waiting = contentTreeTransitionReducer(retargeted, { type: 'return-requested' })
    expect(waiting.phase).toBe('return-waiting')

    const returning = contentTreeTransitionReducer(waiting, {
      type: 'return-target-resolved',
      pathname: snapshot.sourcePath,
      target: sourceRect,
    })
    expect(returning.phase).toBe('returning')
    expect(contentTreeTransitionReducer(returning, { type: 'return-motion-completed' })).toEqual(
      idleContentTreeTransitionState
    )
  })

  it('ignores an article switch outside the opening and retained phases or for a non-local path', () => {
    const action = { type: 'article-switched' as const, targetPath: '/zh/hardware/another-post' }

    expect(contentTreeTransitionReducer(idleContentTreeTransitionState, action)).toEqual(
      idleContentTreeTransitionState
    )

    const retained = contentTreeTransitionReducer(
      contentTreeTransitionReducer(
        contentTreeTransitionReducer(idleContentTreeTransitionState, {
          type: 'open-started',
          snapshot,
          viewport,
          reducedMotion: false,
        }),
        { type: 'route-committed', pathname: snapshot.targetPath }
      ),
      { type: 'open-motion-completed' }
    )
    const waiting = contentTreeTransitionReducer(retained, { type: 'return-requested' })

    expect(contentTreeTransitionReducer(waiting, action)).toEqual(waiting)
    expect(
      contentTreeTransitionReducer(retained, {
        type: 'article-switched',
        targetPath: 'https://example.com/zh/hardware/another-post',
      })
    ).toEqual(retained)
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
