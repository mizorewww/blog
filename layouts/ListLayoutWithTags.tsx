'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MutableRefObject } from 'react'
import { BlogFrame, countCategories, countTags } from '@/components/BlogWidgets'
import ExpandablePostCard from '@/components/ExpandablePostCard'
import type { BlogListPost } from '@/lib/listPosts'
import { defaultLocale, localeConfig, type Locale, ui } from '@/lib/i18n'

interface ListLayoutProps {
  posts: BlogListPost[]
  title: string
  locale?: Locale
  categoryCounts?: Record<string, number>
  tagCounts?: Record<string, number>
  initialDisplayPosts?: BlogListPost[]
  initialExpandedPath?: string | null
}

const POSTS_PER_BATCH = 5
const MOTION_DURATION = 560
const DESKTOP_EXPANDED_TARGET_OFFSET = 96
const MOBILE_EXPANDED_TARGET_OFFSET = 88

type MotionPhase = 'idle' | 'expanding' | 'collapsing-prep' | 'collapsing'
type MotionContext = {
  previousCardTop: number | null
  previousScrollY: number | null
  previousUrl?: string | null
}

type BlogHistoryState = {
  blogListReturn?: {
    postPath?: string
    previousCardTop?: number | null
    previousScrollY?: number | null
  }
}

function normalizePathname(pathname: string) {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const withoutTrailingSlash = normalized.replace(/\/+$/, '')

  return withoutTrailingSlash || '/'
}

function getExpandedPathFromLocation(posts: BlogListPost[]) {
  if (typeof window === 'undefined') {
    return null
  }

  const currentPath = normalizePathname(decodeURI(window.location.pathname))
  const matchingPost = posts.find((post) => normalizePathname(`/${post.path}`) === currentPath)

  return matchingPost?.path || null
}

function getBlogListReturnContext(state: unknown, postPath: string): MotionContext | null {
  const listReturn = (state as BlogHistoryState | null)?.blogListReturn

  if (!listReturn || listReturn.postPath !== postPath) {
    return null
  }

  return {
    previousCardTop:
      typeof listReturn.previousCardTop === 'number' ? listReturn.previousCardTop : null,
    previousScrollY:
      typeof listReturn.previousScrollY === 'number' ? listReturn.previousScrollY : null,
    previousUrl: null,
  }
}

function getInitialVisibleCount(
  posts: BlogListPost[],
  initialDisplayCount: number,
  expandedPath?: string | null
) {
  const expandedIndex = expandedPath ? posts.findIndex((post) => post.path === expandedPath) : -1

  return Math.max(initialDisplayCount || POSTS_PER_BATCH, POSTS_PER_BATCH, expandedIndex + 1)
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getExpandedTargetOffset() {
  return window.matchMedia('(max-width: 639px)').matches
    ? MOBILE_EXPANDED_TARGET_OFFSET
    : DESKTOP_EXPANDED_TARGET_OFFSET
}

function cubicBezierCoordinate(t: number, point1: number, point2: number) {
  const inverse = 1 - t

  return 3 * inverse * inverse * t * point1 + 3 * inverse * t * t * point2 + t * t * t
}

function cubicBezierDerivative(t: number, point1: number, point2: number) {
  const inverse = 1 - t

  return (
    3 * inverse * inverse * point1 + 6 * inverse * t * (point2 - point1) + 3 * t * t * (1 - point2)
  )
}

function easeMotion(progress: number) {
  let t = progress

  for (let index = 0; index < 5; index += 1) {
    const x = cubicBezierCoordinate(t, 0.22, 0.36) - progress
    const derivative = cubicBezierDerivative(t, 0.22, 0.36)

    if (Math.abs(x) < 0.0001 || derivative === 0) break
    t = Math.min(1, Math.max(0, t - x / derivative))
  }

  return cubicBezierCoordinate(t, 1, 1)
}

function setScrollY(top: number) {
  const root = document.documentElement
  const previousScrollBehavior = root.style.scrollBehavior

  root.style.scrollBehavior = 'auto'
  window.scrollTo(0, top)
  root.style.scrollBehavior = previousScrollBehavior
}

function getPostShell(postPath: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-post-shell]')).find(
    (shell) => shell.dataset.postShell === postPath
  )
}

function getMainColumnHeight() {
  const mainColumn = document.querySelector<HTMLElement>('.blog-main-column')

  return mainColumn ? Math.ceil(mainColumn.getBoundingClientRect().height) : null
}

function setPostTop(postPath: string, targetTop: number) {
  const shell = getPostShell(postPath)
  if (!shell) return

  const currentTop = shell.getBoundingClientRect().top
  setScrollY(window.scrollY + currentTop - targetTop)
}

function animateScrollTo(
  targetY: number,
  duration: number,
  frameRef: MutableRefObject<number | null>,
  onComplete?: () => void
) {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  const startY = window.scrollY
  const distance = targetY - startY

  if (prefersReducedMotion() || Math.abs(distance) < 1) {
    setScrollY(targetY)
    onComplete?.()
    return
  }

  const startedAt = performance.now()

  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    setScrollY(startY + distance * easeMotion(progress))

    if (progress < 1) {
      frameRef.current = window.requestAnimationFrame(tick)
      return
    }

    frameRef.current = null
    setScrollY(targetY)
    onComplete?.()
  }

  frameRef.current = window.requestAnimationFrame(tick)
}

function animatePostTopTo(
  postPath: string,
  startTop: number,
  targetTop: number,
  duration: number,
  frameRef: MutableRefObject<number | null>,
  onComplete?: () => void
) {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  if (prefersReducedMotion()) {
    setPostTop(postPath, targetTop)
    onComplete?.()
    return
  }

  const startedAt = performance.now()

  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const desiredTop = startTop + (targetTop - startTop) * easeMotion(progress)

    setPostTop(postPath, desiredTop)

    if (progress < 1) {
      frameRef.current = window.requestAnimationFrame(tick)
      return
    }

    frameRef.current = null
    setPostTop(postPath, targetTop)
    onComplete?.()
  }

  frameRef.current = window.requestAnimationFrame(tick)
}

export default function ListLayoutWithTags({
  posts,
  title,
  locale = defaultLocale,
  categoryCounts: providedCategoryCounts,
  tagCounts: providedTagCounts,
  initialDisplayPosts = [],
  initialExpandedPath = null,
}: ListLayoutProps) {
  const [visibleCount, setVisibleCount] = useState(
    getInitialVisibleCount(posts, initialDisplayPosts.length, initialExpandedPath)
  )
  const [expandedPath, setExpandedPath] = useState<string | null>(initialExpandedPath)
  const [motionPhase, setMotionPhase] = useState<MotionPhase>('idle')
  const [motionPath, setMotionPath] = useState<string | null>(initialExpandedPath)
  const [motionMinHeight, setMotionMinHeight] = useState<number | null>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const categoryCounts = providedCategoryCounts || countCategories(posts)
  const tagCounts = providedTagCounts || countTags(posts)
  const displayPosts = posts.slice(0, visibleCount)
  const expandedIndex = expandedPath
    ? displayPosts.findIndex((post) => post.path === expandedPath)
    : -1
  const expandedPost = expandedIndex >= 0 ? displayPosts[expandedIndex] : undefined
  const shouldRenderFullList =
    !expandedPost || motionPhase === 'expanding' || motionPhase.startsWith('collapsing')
  const visiblePosts = shouldRenderFullList ? displayPosts : [expandedPost]
  const motionIndex = motionPath ? displayPosts.findIndex((post) => post.path === motionPath) : -1
  const hasMore = !expandedPath && visibleCount < posts.length
  const clearMotionTimers = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])
  const getCollapsedTargetTop = useCallback(
    (post: BlogListPost, context: MotionContext) => {
      if (context.previousCardTop !== null) {
        return context.previousCardTop
      }

      const postIndex = posts.findIndex((item) => item.path === post.path)

      if (postIndex <= 0) {
        return getExpandedTargetOffset()
      }

      const shell = getPostShell(post.path)
      const shellHeight = shell?.getBoundingClientRect().height || 0

      const targetOffset = getExpandedTargetOffset()

      return Math.max(targetOffset, (window.innerHeight - shellHeight) / 2)
    },
    [posts]
  )

  const expandPost = useCallback(
    (post: BlogListPost, context: MotionContext) => {
      clearMotionTimers()

      const nextVisibleCount = Math.max(
        visibleCount,
        posts.findIndex((item) => item.path === post.path) + 1
      )
      const startTop =
        getPostShell(post.path)?.getBoundingClientRect().top ??
        context.previousCardTop ??
        getExpandedTargetOffset()

      flushSync(() => {
        setMotionMinHeight(getMainColumnHeight())
        setVisibleCount(nextVisibleCount)
        setMotionPath(post.path)
        setExpandedPath(post.path)
        setMotionPhase('expanding')
      })

      animatePostTopTo(
        post.path,
        startTop,
        getExpandedTargetOffset(),
        MOTION_DURATION,
        scrollFrameRef,
        () => {
          setPostTop(post.path, getExpandedTargetOffset())
          setMotionPhase('idle')
          setMotionPath(post.path)
          setMotionMinHeight(null)
        }
      )
    },
    [clearMotionTimers, posts, visibleCount]
  )

  const collapsePost = useCallback(
    (post: BlogListPost, context: MotionContext) => {
      clearMotionTimers()

      const nextVisibleCount = Math.max(
        visibleCount,
        posts.findIndex((item) => item.path === post.path) + 1
      )
      const startTop =
        getPostShell(post.path)?.getBoundingClientRect().top ?? getExpandedTargetOffset()
      const targetTop = getCollapsedTargetTop(post, context)

      flushSync(() => {
        setVisibleCount(nextVisibleCount)
        setMotionPath(post.path)
        setExpandedPath(null)
        setMotionPhase('collapsing-prep')
      })
      setPostTop(post.path, startTop)

      requestAnimationFrame(() => {
        flushSync(() => {
          setMotionPhase('collapsing')
        })
        setPostTop(post.path, startTop)

        animatePostTopTo(post.path, startTop, targetTop, MOTION_DURATION, scrollFrameRef, () => {
          setPostTop(post.path, targetTop)
          setMotionPhase('idle')
          setMotionPath(null)
        })
      })
    },
    [clearMotionTimers, getCollapsedTargetTop, posts, visibleCount]
  )

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) {
      return
    }

    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'

    return () => {
      window.history.scrollRestoration = previousScrollRestoration
    }
  }, [])

  useEffect(() => {
    const nextExpandedPath = getExpandedPathFromLocation(posts) || initialExpandedPath

    clearMotionTimers()
    setVisibleCount(getInitialVisibleCount(posts, initialDisplayPosts.length, nextExpandedPath))
    setExpandedPath(nextExpandedPath)
    setMotionPath(nextExpandedPath)
    setMotionMinHeight(null)
    setMotionPhase('idle')
  }, [clearMotionTimers, initialDisplayPosts.length, initialExpandedPath, posts])

  useEffect(() => {
    const syncExpandedPath = (event?: PopStateEvent) => {
      const nextExpandedPath = getExpandedPathFromLocation(posts)

      if (!nextExpandedPath && expandedPath) {
        const expandedPost = posts.find((post) => post.path === expandedPath)

        if (expandedPost) {
          collapsePost(
            expandedPost,
            getBlogListReturnContext(event?.state, expandedPath) || {
              previousCardTop: null,
              previousScrollY: null,
            }
          )
          return
        }
      }

      clearMotionTimers()
      setVisibleCount(getInitialVisibleCount(posts, initialDisplayPosts.length, nextExpandedPath))
      setExpandedPath(nextExpandedPath)
      setMotionPath(nextExpandedPath)
      setMotionMinHeight(null)
      setMotionPhase('idle')
    }

    window.addEventListener('popstate', syncExpandedPath)

    return () => window.removeEventListener('popstate', syncExpandedPath)
  }, [clearMotionTimers, collapsePost, expandedPath, initialDisplayPosts.length, posts])

  useEffect(() => {
    return () => clearMotionTimers()
  }, [clearMotionTimers])

  useEffect(() => {
    const updateBackToTop = () => setShowBackToTop(window.scrollY > 420)

    updateBackToTop()
    window.addEventListener('scroll', updateBackToTop, { passive: true })

    return () => window.removeEventListener('scroll', updateBackToTop)
  }, [])

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current

    if (!loadMoreElement || !hasMore) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, posts.length))
        }
      },
      { rootMargin: '240px 0px' }
    )

    observer.observe(loadMoreElement)

    return () => observer.disconnect()
  }, [hasMore, posts.length])

  return (
    <BlogFrame
      posts={posts}
      categoryCounts={categoryCounts}
      tagCounts={tagCounts}
      locale={locale}
      dateLocale={dateLocale}
    >
      <div style={motionMinHeight ? { minHeight: motionMinHeight } : undefined}>
        {!expandedPost && <h1 className="sr-only">{title}</h1>}
        {!visiblePosts.length && (
          <div className="rounded-[10px] bg-white px-8 py-10 text-slate-600 dark:bg-[#252d38] dark:text-white/70">
            {labels.noPosts}
          </div>
        )}
        {visiblePosts.map((post, index) => {
          const isMotionTarget = post.path === motionPath
          const isCollapsedShell =
            !isMotionTarget && (motionPhase === 'expanding' || motionPhase === 'collapsing-prep')
          const isTransitionTarget =
            isMotionTarget && (motionPhase === 'expanding' || motionPhase === 'collapsing-prep')
          const isBeforeMotionTarget = motionIndex >= 0 && index < motionIndex
          const collapsedTranslate = isBeforeMotionTarget ? '-translate-y-8' : 'translate-y-8'

          return (
            <div
              key={post.path}
              data-post-shell={post.path}
              className={`grid transform-gpu transition-all duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0 ${
                isCollapsedShell
                  ? `mt-0 ${collapsedTranslate} grid-rows-[0fr] opacity-0`
                  : `${index === 0 || isTransitionTarget ? 'mt-0' : 'mt-6'} translate-y-0 grid-rows-[1fr] opacity-100`
              }`}
              aria-hidden={isCollapsedShell || undefined}
            >
              <div className="min-h-0 overflow-hidden">
                <ExpandablePostCard
                  post={post}
                  locale={locale}
                  dateLocale={dateLocale}
                  expanded={expandedPath === post.path}
                  onExpandedChange={(expanded, context) => {
                    if (expanded) {
                      expandPost(post, context)
                      return
                    }

                    collapsePost(post, context)
                  }}
                />
              </div>
            </div>
          )
        })}
        {hasMore && <div ref={loadMoreRef} className="mt-6 h-12" aria-hidden="true" />}
        <button
          type="button"
          aria-label="回到顶部"
          onClick={() => {
            clearMotionTimers()
            animateScrollTo(0, MOTION_DURATION, scrollFrameRef)
          }}
          className={`fixed right-4 bottom-5 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-[0_10px_30px_rgba(15,23,42,0.16)] backdrop-blur transition duration-300 hover:text-sky-500 sm:right-6 lg:right-8 dark:bg-[#252d38]/90 dark:text-white/75 dark:hover:text-sky-400 ${
            showBackToTop
              ? 'pointer-events-auto translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-3 opacity-0'
          }`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
            <path
              d="M12 19V5m0 0-6 6m6-6 6 6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>
    </BlogFrame>
  )
}
