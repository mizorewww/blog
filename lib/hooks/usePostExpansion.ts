'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { BlogListPost } from '@/lib/listPosts'
import {
  getExpandedPathFromPathname,
  getInitialVisibleCount,
  POSTS_PER_BATCH,
  type MotionPhase,
} from '@/lib/blogExpansionState'
import {
  BLOG_PATH_CHANGE_EVENT,
  consumePendingBlogCollapseMotion,
  consumePendingBlogNavigationMotion,
  getBlogListReturnContext,
  isHomePath,
  type BlogMotionContext as MotionContext,
} from '@/lib/blogRouteState'
import {
  MOTION_DURATION,
  animatePostTopTo,
  animateScrollTo,
  getExpandedTargetOffset,
  getMainColumnHeight,
  getPostShell,
  prefersReducedMotion,
  setPostTop,
  setScrollY,
} from '@/lib/postMotion'

function getExpandedPathFromLocation(posts: BlogListPost[]) {
  if (typeof window === 'undefined') {
    return null
  }

  return getExpandedPathFromPathname(posts, window.location.pathname)
}

export function usePostExpansion({
  initialDisplayCount,
  initialExpandedPath,
  pathname,
  posts,
}: {
  initialDisplayCount: number
  initialExpandedPath: string | null
  pathname: string
  posts: BlogListPost[]
}) {
  const pendingInitialMotionRef = useRef<MotionContext | null | undefined>(undefined)

  if (pendingInitialMotionRef.current === undefined) {
    pendingInitialMotionRef.current = initialExpandedPath
      ? consumePendingBlogNavigationMotion(initialExpandedPath)
      : null
  }

  const shouldAnimateInitialExpansion = Boolean(pendingInitialMotionRef.current)
  const [visibleCount, setVisibleCount] = useState(
    getInitialVisibleCount(posts, initialDisplayCount, initialExpandedPath)
  )
  const [expandedPath, setExpandedPath] = useState<string | null>(
    shouldAnimateInitialExpansion ? null : initialExpandedPath
  )
  const [motionPhase, setMotionPhase] = useState<MotionPhase>('idle')
  const [motionPath, setMotionPath] = useState<string | null>(
    shouldAnimateInitialExpansion ? null : initialExpandedPath
  )
  const [motionMinHeight, setMotionMinHeight] = useState<number | null>(null)
  const bodyExpansionTimerRef = useRef<number | null>(null)
  const collapsePrepFrameRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)

  const clearMotionTimers = useCallback(() => {
    if (bodyExpansionTimerRef.current !== null) {
      window.clearTimeout(bodyExpansionTimerRef.current)
      bodyExpansionTimerRef.current = null
    }

    if (collapsePrepFrameRef.current !== null) {
      window.cancelAnimationFrame(collapsePrepFrameRef.current)
      collapsePrepFrameRef.current = null
    }

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  const finishExpansion = useCallback((postPath: string) => {
    setPostTop(postPath, getExpandedTargetOffset())
    setMotionPhase('idle')
    setMotionPath(postPath)
    setMotionMinHeight(null)
  }, [])

  const getSavedScrollTargetTop = useCallback(
    (postPath: string, previousScrollY: number | null) => {
      if (typeof previousScrollY !== 'number') {
        return null
      }

      const shell = getPostShell(postPath)

      if (!shell) {
        return null
      }

      return shell.getBoundingClientRect().top + window.scrollY - previousScrollY
    },
    []
  )

  const getCollapsedTargetTop = useCallback(
    (post: BlogListPost, context: MotionContext) => {
      const savedScrollTargetTop = getSavedScrollTargetTop(post.path, context.previousScrollY)

      if (savedScrollTargetTop !== null) {
        return savedScrollTargetTop
      }

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
    [getSavedScrollTargetTop, posts]
  )

  const startBodyExpansion = useCallback(
    (postPath: string) => {
      flushSync(() => {
        setExpandedPath(postPath)
        setMotionPhase('expanding')
      })
      setPostTop(postPath, getExpandedTargetOffset())

      const complete = () => {
        bodyExpansionTimerRef.current = null
        finishExpansion(postPath)
      }

      if (prefersReducedMotion()) {
        complete()
        return
      }

      bodyExpansionTimerRef.current = window.setTimeout(complete, MOTION_DURATION + 80)
    },
    [finishExpansion]
  )

  const positionThenExpandPost = useCallback(
    (post: BlogListPost, context: MotionContext) => {
      clearMotionTimers()

      const nextVisibleCount = posts.findIndex((item) => item.path === post.path) + 1
      const targetTop = getExpandedTargetOffset()

      flushSync(() => {
        setMotionMinHeight(getMainColumnHeight())
        setVisibleCount((count) => Math.max(count, nextVisibleCount))
        setMotionPath(post.path)
        setExpandedPath(null)
        setMotionPhase('positioning')
      })

      const shell = getPostShell(post.path)
      const startTop = shell?.getBoundingClientRect().top ?? context.previousCardTop ?? targetTop
      const completePositioning = () => {
        setPostTop(post.path, targetTop)
        startBodyExpansion(post.path)
      }

      animatePostTopTo(
        post.path,
        startTop,
        targetTop,
        MOTION_DURATION,
        scrollFrameRef,
        completePositioning
      )
    },
    [clearMotionTimers, posts, startBodyExpansion]
  )

  const collapsePost = useCallback(
    (post: BlogListPost, context: MotionContext, startTopOverride?: number) => {
      clearMotionTimers()

      const nextVisibleCount = posts.findIndex((item) => item.path === post.path) + 1

      flushSync(() => {
        setVisibleCount((count) => Math.max(count, nextVisibleCount))
        setMotionPath(post.path)
        setExpandedPath(null)
        setMotionPhase('collapsing-prep')
      })

      const startTop =
        startTopOverride ??
        getPostShell(post.path)?.getBoundingClientRect().top ??
        getExpandedTargetOffset()
      const targetTop = getCollapsedTargetTop(post, context)
      const restorePreviousScrollY = () => {
        if (typeof context.previousScrollY === 'number') {
          setScrollY(context.previousScrollY)
        }
      }

      setPostTop(post.path, startTop)

      collapsePrepFrameRef.current = window.requestAnimationFrame(() => {
        collapsePrepFrameRef.current = null

        flushSync(() => {
          setMotionPhase('collapsing')
        })
        setPostTop(post.path, startTop)

        animatePostTopTo(post.path, startTop, targetTop, MOTION_DURATION, scrollFrameRef, () => {
          setPostTop(post.path, targetTop)
          restorePreviousScrollY()
          setMotionPhase('idle')
          setMotionPath(null)
        })
      })
    },
    [clearMotionTimers, getCollapsedTargetTop, posts]
  )

  const loadMorePosts = useCallback(() => {
    setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, posts.length))
  }, [posts.length])

  const scrollToTop = useCallback(() => {
    clearMotionTimers()
    animateScrollTo(0, MOTION_DURATION, scrollFrameRef)
  }, [clearMotionTimers])

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

  useLayoutEffect(() => {
    const nextExpandedPath = getExpandedPathFromPathname(posts, pathname)
    const pendingInitialMotion =
      pendingInitialMotionRef.current ||
      (nextExpandedPath ? consumePendingBlogNavigationMotion(nextExpandedPath) : null)
    const pendingCollapseMotion = nextExpandedPath
      ? null
      : consumePendingBlogCollapseMotion(posts.map((post) => post.path))

    if (pendingInitialMotion && nextExpandedPath) {
      const post = posts.find((item) => item.path === nextExpandedPath)

      pendingInitialMotionRef.current = null
      clearMotionTimers()
      setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
      setExpandedPath(null)
      setMotionPath(null)
      setMotionMinHeight(null)
      setMotionPhase('idle')

      if (post) {
        const frame = window.requestAnimationFrame(() => {
          positionThenExpandPost(post, pendingInitialMotion)
        })

        return () => window.cancelAnimationFrame(frame)
      }
    }

    if (pendingCollapseMotion) {
      const post = posts.find((item) => item.path === pendingCollapseMotion.postPath)

      pendingInitialMotionRef.current = null
      clearMotionTimers()
      setExpandedPath(null)
      setMotionPath(null)
      setMotionMinHeight(null)
      setMotionPhase('idle')

      if (post) {
        const frame = window.requestAnimationFrame(() => {
          collapsePost(post, pendingCollapseMotion, getExpandedTargetOffset())
        })

        return () => window.cancelAnimationFrame(frame)
      }
    }

    clearMotionTimers()
    setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
    setExpandedPath(nextExpandedPath)
    setMotionPath(nextExpandedPath)
    setMotionMinHeight(null)
    setMotionPhase('idle')
  }, [
    clearMotionTimers,
    collapsePost,
    initialDisplayCount,
    initialExpandedPath,
    pathname,
    positionThenExpandPost,
    posts,
  ])

  useEffect(() => {
    const collapseOnHomeClick = (event: MouseEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const anchor = target.closest<HTMLAnchorElement>('a[href]')

      if (!anchor) {
        return
      }

      const targetUrl = new URL(anchor.href, window.location.href)

      if (targetUrl.origin !== window.location.origin || !isHomePath(targetUrl.pathname)) {
        return
      }

      clearMotionTimers()
      setExpandedPath(null)
      setMotionPath(null)
      setMotionMinHeight(null)
      setMotionPhase('idle')

      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event(BLOG_PATH_CHANGE_EVENT))
      })
    }

    document.addEventListener('click', collapseOnHomeClick, true)

    return () => document.removeEventListener('click', collapseOnHomeClick, true)
  }, [clearMotionTimers])

  useEffect(() => {
    const syncExpandedPath = (event?: Event) => {
      const nextExpandedPath = getExpandedPathFromLocation(posts)

      if (!nextExpandedPath && expandedPath) {
        const expandedPost = posts.find((post) => post.path === expandedPath)
        const eventState = event && 'state' in event ? event.state : undefined

        if (expandedPost) {
          collapsePost(
            expandedPost,
            getBlogListReturnContext(eventState, expandedPath) || {
              previousCardTop: null,
              previousScrollY: null,
            }
          )
          return
        }
      }

      clearMotionTimers()
      setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
      setExpandedPath(nextExpandedPath)
      setMotionPath(nextExpandedPath)
      setMotionMinHeight(null)
      setMotionPhase('idle')
    }

    window.addEventListener('popstate', syncExpandedPath)
    window.addEventListener(BLOG_PATH_CHANGE_EVENT, syncExpandedPath)

    return () => {
      window.removeEventListener('popstate', syncExpandedPath)
      window.removeEventListener(BLOG_PATH_CHANGE_EVENT, syncExpandedPath)
    }
  }, [clearMotionTimers, collapsePost, expandedPath, initialDisplayCount, posts])

  useEffect(() => {
    return () => clearMotionTimers()
  }, [clearMotionTimers])

  return {
    expandedPath,
    loadMorePosts,
    motionMinHeight,
    motionPath,
    motionPhase,
    scrollToTop,
    visibleCount,
  }
}
