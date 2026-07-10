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
import {
  articleTransitionReducer,
  createArticleTransitionTarget,
  idleArticleTransitionState,
  rectIntersectsViewport,
  type ArticleCardSnapshot,
  type ArticleNavigationIntent,
  type ArticleTransitionRect,
  type ArticleTransitionState,
} from '@/lib/articleTransition'
import { isBlogPostPath, normalizePathname } from '@/lib/blogRouteState'
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
  const [hideHeaderOnMobile, setHideHeaderOnMobile] = useState(false)
  const previousScrollYRef = useRef(0)
  const transitionStateRef = useRef<ArticleTransitionState>(transitionState)
  const isReadingPost = isBlogPostPath(pathname)
  const shouldReduceMotion = useReducedMotion()
  const { resolvedTheme } = useTheme()
  transitionStateRef.current = transitionState

  const handleArticleNavigation = useCallback(
    (intent: ArticleNavigationIntent) => {
      if (intent.kind === 'cancel') {
        setFallbackTargetPath(null)
        dispatchTransition({ type: 'cancelled' })
        return
      }

      if (intent.kind === 'fallback') {
        dispatchTransition({ type: 'cancelled' })
        setFallbackTargetPath(normalizePathname(intent.targetPath))
        return
      }

      setFallbackTargetPath(null)
      dispatchTransition({
        type: 'open-started',
        snapshot: intent.snapshot,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        reducedMotion: Boolean(shouldReduceMotion),
      })
    },
    [shouldReduceMotion]
  )

  const requestReturnTransition = useCallback(() => {
    const current = transitionStateRef.current

    if (
      (current.phase !== 'retained' && current.phase !== 'opening') ||
      normalizePathname(window.location.pathname) !== current.snapshot.targetPath ||
      !articleHeroIntersectsViewport()
    ) {
      return false
    }

    setFallbackTargetPath(null)
    dispatchTransition({ type: 'return-requested' })
    return true
  }, [])

  const requestPopStateReturnTransition = useCallback(() => {
    const current = transitionStateRef.current

    if (
      (current.phase !== 'retained' && current.phase !== 'opening') ||
      normalizePathname(window.location.pathname) !== current.snapshot.sourcePath ||
      !articleHeroIntersectsViewport()
    ) {
      return false
    }

    setFallbackTargetPath(null)
    dispatchTransition({ type: 'return-requested' })
    return true
  }, [])

  useEffect(() => {
    setFallbackTargetPath(null)
    dispatchTransition({ type: 'route-committed', pathname })
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
          onOpenMotionComplete={() => dispatchTransition({ type: 'open-motion-completed' })}
          onReturnMotionComplete={() => dispatchTransition({ type: 'return-motion-completed' })}
        />
        {fallbackTargetPath && (
          <div
            data-article-transition-fallback={fallbackTargetPath}
            className="dark:bg-surface-page-dark bg-surface-page pointer-events-none fixed inset-x-0 top-[72px] bottom-0 z-40 overflow-hidden sm:top-[96px]"
          >
            <ArticleRouteSkeleton />
          </div>
        )}
        <main id="main-content" tabIndex={-1} className="flex-1 pt-[72px] sm:pt-[96px]">
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
