'use client'

import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useReducedMotion } from 'motion/react'
import { Toaster } from 'sonner'
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import BlogListNavigationRecorder from './BlogListNavigationRecorder'
import Footer from './Footer'
import Header from './Header'
import { ArticleTransitionProvider } from './ArticleTransitionContext'
import ArticleCardTransitionOverlay from './animata/ArticleCardTransitionOverlay'
import ArticleRouteSkeleton from './animata/ArticleRouteSkeleton'
import ArticleSurfaceVeil from './animata/ArticleSurfaceVeil'
import ContentTreeTransitionOverlay from './animata/ContentTreeTransitionOverlay'
import {
  articleTransitionReducer,
  createArticleTransitionTarget,
  deriveArticleTransitionDestinationStage,
  idleArticleTransitionState,
  rectIntersectsViewport,
  type ArticleCardSnapshot,
  type ArticleNavigationIntent,
  type ArticleTransitionRect,
  type ArticleTransitionSequence,
  type ArticleTransitionState,
} from '@/lib/articleTransition'
import { isBlogPostPath, normalizePathname } from '@/lib/blogRouteState'
import {
  articleSurfaceVeilReducer,
  contentTreeTransitionReducer,
  createContentTreeReturnTarget,
  deriveContentTreeReturnStage,
  deriveContentTreeTransitionStage,
  getArticleSurfaceVeilRect,
  getContentTreeSlideDuration,
  idleArticleSurfaceVeilState,
  idleContentTreeTransitionState,
  type ContentTreeTransitionState,
} from '@/lib/contentTreeTransition'
import { getLocaleFromPathname, ui } from '@/lib/i18n'

const HEADER_HIDE_SCROLL_Y = 80
const SCROLL_DELTA_THRESHOLD = 6
const RETURN_STABILITY_TOLERANCE = 0.5

function toTransitionRect(rect: DOMRect): ArticleTransitionRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function findTransitionCard(key: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-article-transition-card]')).find(
    (card) => card.dataset.articleTransitionKey === key
  )
}

function readReturnTarget(snapshot: ArticleCardSnapshot) {
  const card = findTransitionCard(snapshot.key)
  const cover = card?.querySelector<HTMLElement>('[data-article-transition-cover]')

  if (!card || !cover) {
    return null
  }

  return createArticleTransitionTarget(
    {
      cardRect: toTransitionRect(card.getBoundingClientRect()),
      coverRect: toTransitionRect(cover.getBoundingClientRect()),
      radius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius),
    },
    { width: window.innerWidth, height: window.innerHeight }
  )
}

function rectDelta(left: ArticleTransitionRect, right: ArticleTransitionRect) {
  return Math.max(
    Math.abs(left.top - right.top),
    Math.abs(left.left - right.left),
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height)
  )
}

function articleHeroIntersectsViewport() {
  const articleSurface = document.querySelector<HTMLElement>('[data-article-surface]')
  const articleCover = document.querySelector<HTMLElement>('[data-article-cover]')
  const viewport = { width: window.innerWidth, height: window.innerHeight }

  return (
    articleSurface !== null &&
    articleCover !== null &&
    rectIntersectsViewport(toTransitionRect(articleSurface.getBoundingClientRect()), viewport) &&
    rectIntersectsViewport(toTransitionRect(articleCover.getBoundingClientRect()), viewport)
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [fallbackTargetPath, setFallbackTargetPath] = useState<string | null>(null)
  const [transitionState, dispatchTransition] = useReducer(
    articleTransitionReducer,
    idleArticleTransitionState
  )
  const [treeTransitionState, dispatchTreeTransition] = useReducer(
    contentTreeTransitionReducer,
    idleContentTreeTransitionState
  )
  const [veilState, dispatchVeil] = useReducer(
    articleSurfaceVeilReducer,
    idleArticleSurfaceVeilState
  )
  const [cardSequence, setCardSequence] = useState<ArticleTransitionSequence | null>(null)
  const [hideHeaderOnMobile, setHideHeaderOnMobile] = useState(false)
  const previousScrollYRef = useRef(0)
  const mainRef = useRef<HTMLElement>(null)
  const routeFocusReadyRef = useRef(false)
  const transitionStateRef = useRef<ArticleTransitionState>(transitionState)
  const treeTransitionStateRef = useRef<ContentTreeTransitionState>(treeTransitionState)
  const isReadingPost = isBlogPostPath(pathname)
  const shouldReduceMotion = useReducedMotion()
  const { resolvedTheme } = useTheme()
  transitionStateRef.current = transitionState
  treeTransitionStateRef.current = treeTransitionState
  const destinationStage = deriveArticleTransitionDestinationStage(transitionState, pathname)
  const treeDestinationStage = deriveContentTreeTransitionStage(treeTransitionState, pathname)
  const treeReturnStage = deriveContentTreeReturnStage(treeTransitionState, pathname)
  const cardTransitionActive = transitionState.phase !== 'idle'
  const cardCompanionTreeProps = cardTransitionActive
    ? {
        holdMotion:
          Boolean(!shouldReduceMotion) && cardSequence !== 'morph' && cardSequence !== 'settle',
        slideDuration: getContentTreeSlideDuration({
          phase: treeTransitionState.phase,
          companion: true,
          reducedMotion: Boolean(shouldReduceMotion),
        }),
        completePolicy: 'card-sequence' as const,
      }
    : {}

  const handleArticleNavigation = useCallback(
    (intent: ArticleNavigationIntent) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const reducedMotion = Boolean(shouldReduceMotion)

      if (intent.kind === 'cancel') {
        setFallbackTargetPath(null)
        dispatchTransition({ type: 'cancelled' })
        dispatchTreeTransition({ type: 'cancelled' })
        dispatchVeil({ type: 'cancelled' })
        return
      }

      if (intent.kind === 'fallback') {
        dispatchTransition({ type: 'cancelled' })
        dispatchTreeTransition({ type: 'cancelled' })
        dispatchVeil({ type: 'cancelled' })
        setFallbackTargetPath(normalizePathname(intent.targetPath))
        return
      }

      setFallbackTargetPath(null)

      if (intent.kind === 'article-switch') {
        dispatchTransition({ type: 'cancelled' })
        dispatchTreeTransition({ type: 'cancelled' })
        dispatchVeil({
          type: 'cover-started',
          targetPath: intent.targetPath,
          rect: intent.surfaceRect,
          reducedMotion,
        })
        return
      }

      if (intent.kind === 'tree-open') {
        dispatchTransition({ type: 'cancelled' })
        dispatchTreeTransition({
          type: 'open-started',
          snapshot: intent.tree,
          viewport,
          reducedMotion,
        })
        const veilRect = getArticleSurfaceVeilRect(viewport)
        if (veilRect) {
          dispatchVeil({
            type: 'cover-started',
            targetPath: intent.targetPath,
            rect: veilRect,
            reducedMotion,
          })
        } else {
          dispatchVeil({ type: 'cancelled' })
        }
        return
      }

      dispatchVeil({ type: 'cancelled' })
      dispatchTransition({
        type: 'open-started',
        snapshot: intent.snapshot,
        viewport,
        reducedMotion,
      })
      if (intent.tree) {
        dispatchTreeTransition({
          type: 'open-started',
          snapshot: intent.tree,
          viewport,
          reducedMotion,
        })
      } else {
        dispatchTreeTransition({ type: 'cancelled' })
      }
    },
    [shouldReduceMotion]
  )

  const requestReturnTransition = useCallback(() => {
    const current = transitionStateRef.current
    const treeCurrent = treeTransitionStateRef.current
    const onTargetArticle =
      current.phase !== 'idle' &&
      normalizePathname(window.location.pathname) === current.snapshot.targetPath
    const onTreeTargetArticle =
      treeCurrent.phase !== 'idle' &&
      normalizePathname(window.location.pathname) === treeCurrent.snapshot.targetPath

    if (
      (current.phase === 'retained' || current.phase === 'opening') &&
      onTargetArticle &&
      articleHeroIntersectsViewport()
    ) {
      setFallbackTargetPath(null)
      dispatchTransition({ type: 'return-requested' })
      dispatchTreeTransition({ type: 'return-requested' })
      return true
    }

    if (
      (treeCurrent.phase === 'retained' || treeCurrent.phase === 'opening') &&
      onTreeTargetArticle
    ) {
      setFallbackTargetPath(null)
      dispatchTreeTransition({ type: 'return-requested' })
      return true
    }

    return false
  }, [])

  const requestTreeReturnTransition = useCallback(() => {
    const current = treeTransitionStateRef.current

    if (current.phase !== 'retained' && current.phase !== 'opening') {
      return false
    }

    setFallbackTargetPath(null)
    dispatchTreeTransition({ type: 'return-requested' })
    return true
  }, [])

  const requestPopStateReturnTransition = useCallback(() => {
    const current = transitionStateRef.current
    const treeCurrent = treeTransitionStateRef.current

    if (
      (current.phase === 'retained' || current.phase === 'opening') &&
      normalizePathname(window.location.pathname) === current.snapshot.sourcePath &&
      articleHeroIntersectsViewport()
    ) {
      setFallbackTargetPath(null)
      dispatchTransition({ type: 'return-requested' })
      dispatchTreeTransition({ type: 'return-requested' })
      return true
    }

    if (
      (treeCurrent.phase === 'retained' || treeCurrent.phase === 'opening') &&
      normalizePathname(window.location.pathname) === treeCurrent.snapshot.sourcePath
    ) {
      return requestTreeReturnTransition()
    }

    return false
  }, [requestTreeReturnTransition])

  useEffect(() => {
    setFallbackTargetPath(null)
    dispatchTransition({ type: 'route-committed', pathname })
    dispatchTreeTransition({ type: 'route-committed', pathname })
    dispatchVeil({ type: 'route-committed', pathname })
  }, [pathname])

  useEffect(() => {
    if (!routeFocusReadyRef.current) {
      routeFocusReadyRef.current = true
      return
    }

    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  useEffect(() => {
    const onPopState = () => {
      requestPopStateReturnTransition()
    }

    window.addEventListener('popstate', onPopState)

    return () => window.removeEventListener('popstate', onPopState)
  }, [requestPopStateReturnTransition])

  useEffect(() => {
    const cancelForViewportChange = () => {
      setFallbackTargetPath(null)
      dispatchTransition({ type: 'viewport-changed' })
      dispatchTreeTransition({ type: 'viewport-changed' })
      dispatchVeil({ type: 'cancelled' })
    }

    window.addEventListener('resize', cancelForViewportChange)

    return () => {
      window.removeEventListener('resize', cancelForViewportChange)
    }
  }, [])

  useEffect(() => {
    if (
      transitionState.phase !== 'return-waiting' ||
      normalizePathname(pathname) !== transitionState.snapshot.sourcePath
    ) {
      return
    }

    let animationFrame = 0
    let cancelled = false
    let previous:
      | {
          scrollY: number
          cardRect: ArticleTransitionRect
          coverRect: ArticleTransitionRect
        }
      | undefined
    let stableComparisons = 0
    let missingMeasurements = 0
    let resizeObserver: ResizeObserver | undefined
    const mutationObserver = new MutationObserver(() => scheduleSample())

    const cancel = () => {
      if (!cancelled) {
        dispatchTransition({ type: 'cancelled' })
      }
    }

    const sample = () => {
      animationFrame = 0

      if (cancelled) {
        return
      }

      const target = readReturnTarget(transitionState.snapshot)
      const card = findTransitionCard(transitionState.snapshot.key)

      if (!target || !card) {
        missingMeasurements += 1

        if (missingMeasurements < 2) {
          animationFrame = window.requestAnimationFrame(sample)
        } else {
          cancel()
        }
        return
      }

      missingMeasurements = 0

      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => scheduleSample())
        resizeObserver.observe(card)
      }

      const current = {
        scrollY: window.scrollY,
        cardRect: target.cardRect,
        coverRect: target.coverRect,
      }

      if (
        previous &&
        Math.abs(previous.scrollY - current.scrollY) <= RETURN_STABILITY_TOLERANCE &&
        rectDelta(previous.cardRect, current.cardRect) <= RETURN_STABILITY_TOLERANCE &&
        rectDelta(previous.coverRect, current.coverRect) <= RETURN_STABILITY_TOLERANCE
      ) {
        stableComparisons += 1
      } else {
        stableComparisons = 0
      }

      previous = current

      if (stableComparisons >= 1) {
        dispatchTransition({
          type: 'return-target-resolved',
          pathname,
          target,
        })
        return
      }

      animationFrame = window.requestAnimationFrame(sample)
    }

    function scheduleSample() {
      if (!cancelled && animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(sample)
      }
    }

    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('scroll', scheduleSample, { passive: true })
    scheduleSample()

    return () => {
      cancelled = true
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', scheduleSample)

      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [pathname, transitionState])

  useEffect(() => {
    if (
      treeTransitionState.phase !== 'return-waiting' ||
      normalizePathname(pathname) !== treeTransitionState.snapshot.sourcePath
    ) {
      return
    }

    // Mirror the card return sampling: the list page may still be laying out or
    // restoring its scroll position when it first mounts, so a single sample can
    // capture a transient rect. Wait until the target is stable across two
    // consecutive frames (and re-sample on scroll/mutation/resize) so the overlay
    // glides to the exact settled position of the real sidebar card.
    let animationFrame = 0
    let cancelled = false
    let previous: { scrollY: number; rect: ArticleTransitionRect } | undefined
    let stableComparisons = 0
    let missingMeasurements = 0
    let resizeObserver: ResizeObserver | undefined
    const mutationObserver = new MutationObserver(() => scheduleSample())

    const cancel = () => {
      if (!cancelled) {
        dispatchTreeTransition({ type: 'cancelled' })
      }
    }

    const sample = () => {
      animationFrame = 0

      if (cancelled) {
        return
      }

      const tree = mainRef.current?.querySelector<HTMLElement>('[data-content-tree]') ?? null
      const container = tree?.closest<HTMLElement>('section') ?? tree
      const target = container
        ? createContentTreeReturnTarget(toTransitionRect(container.getBoundingClientRect()), {
            width: window.innerWidth,
            height: window.innerHeight,
          })
        : null

      if (!target || !container) {
        missingMeasurements += 1

        if (missingMeasurements < 2) {
          animationFrame = window.requestAnimationFrame(sample)
        } else {
          cancel()
        }
        return
      }

      missingMeasurements = 0

      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => scheduleSample())
        resizeObserver.observe(container)
      }

      const current = { scrollY: window.scrollY, rect: target }

      if (
        previous &&
        Math.abs(previous.scrollY - current.scrollY) <= RETURN_STABILITY_TOLERANCE &&
        rectDelta(previous.rect, current.rect) <= RETURN_STABILITY_TOLERANCE
      ) {
        stableComparisons += 1
      } else {
        stableComparisons = 0
      }

      previous = current

      if (stableComparisons >= 1) {
        dispatchTreeTransition({
          type: 'return-target-resolved',
          pathname,
          target,
        })
        return
      }

      animationFrame = window.requestAnimationFrame(sample)
    }

    function scheduleSample() {
      if (!cancelled && animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(sample)
      }
    }

    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('scroll', scheduleSample, { passive: true })
    scheduleSample()

    return () => {
      cancelled = true
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', scheduleSample)

      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [pathname, treeTransitionState])

  useEffect(() => {
    previousScrollYRef.current = window.scrollY
    setHideHeaderOnMobile(false)

    if (!isReadingPost) {
      return
    }

    const syncHeaderVisibility = () => {
      const currentScrollY = window.scrollY
      const scrollDelta = currentScrollY - previousScrollYRef.current

      if (currentScrollY <= SCROLL_DELTA_THRESHOLD) {
        setHideHeaderOnMobile(false)
      } else if (scrollDelta > SCROLL_DELTA_THRESHOLD && currentScrollY > HEADER_HIDE_SCROLL_Y) {
        setHideHeaderOnMobile(true)
      } else if (scrollDelta < -SCROLL_DELTA_THRESHOLD) {
        setHideHeaderOnMobile(false)
      }

      previousScrollYRef.current = currentScrollY
    }

    window.addEventListener('scroll', syncHeaderVisibility, { passive: true })

    return () => window.removeEventListener('scroll', syncHeaderVisibility)
  }, [isReadingPost])

  return (
    <ArticleTransitionProvider requestReturn={requestReturnTransition}>
      <div className="flex min-h-screen flex-col">
        <BlogListNavigationRecorder onArticleNavigation={handleArticleNavigation} />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:rounded focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white"
        >
          {ui[getLocaleFromPathname(pathname)].skipToContent}
        </a>
        <Header hideOnMobile={isReadingPost && hideHeaderOnMobile} />
        <ArticleCardTransitionOverlay
          state={transitionState}
          concealDestination={destinationStage === 'opening'}
          onSequenceChange={setCardSequence}
          onOpenMotionComplete={() => {
            dispatchTransition({ type: 'open-motion-completed' })
            dispatchTreeTransition({ type: 'open-motion-completed' })
          }}
          onReturnMotionComplete={() => {
            dispatchTransition({ type: 'return-motion-completed' })
            dispatchTreeTransition({ type: 'return-motion-completed' })
          }}
        />
        <ContentTreeTransitionOverlay
          state={treeTransitionState}
          concealDestination={treeDestinationStage === 'opening'}
          {...cardCompanionTreeProps}
          onOpenMotionComplete={() => dispatchTreeTransition({ type: 'open-motion-completed' })}
          onReturnMotionComplete={() => dispatchTreeTransition({ type: 'return-motion-completed' })}
        />
        <ArticleSurfaceVeil
          state={veilState}
          onRevealComplete={() => dispatchVeil({ type: 'reveal-completed' })}
        />
        {fallbackTargetPath && (
          <div
            data-article-transition-fallback={fallbackTargetPath}
            className="dark:bg-surface-page-dark bg-surface-page pointer-events-none fixed inset-x-0 top-[72px] bottom-0 z-40 overflow-hidden lg:top-[96px]"
          >
            <ArticleRouteSkeleton />
          </div>
        )}
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="flex-1 pt-[72px] lg:pt-[96px]"
          data-article-transition-destination={destinationStage ?? undefined}
          data-content-tree-transition={treeDestinationStage ?? undefined}
          data-content-tree-transition-return={treeReturnStage ?? undefined}
        >
          {children}
        </main>
        <Footer />
        <Toaster
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          position="bottom-right"
          richColors
        />
      </div>
    </ArticleTransitionProvider>
  )
}
