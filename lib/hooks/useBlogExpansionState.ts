'use client'

import type { AnimationPlaybackControls } from 'motion'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { animataPostDuration } from '@/components/animata/motion'
import type { BlogListPost } from '@/lib/listPosts'
import {
  getExpandedPathFromPathname,
  getInitialVisibleCount,
  POSTS_PER_BATCH,
  type MotionPhase,
} from '@/lib/blogExpansionState'
import {
  consumeCurrentBlogListReturnContext,
  consumePendingBlogCollapseMotion,
  consumePendingBlogNavigationMotion,
  getBlogListReturnContext,
  type BlogMotionContext,
} from '@/lib/blogRouteState'
import {
  animatePostTopTo,
  animateScrollTo,
  getExpandedTargetOffset,
  getMainColumnHeight,
  getPostShell,
  prefersReducedMotion,
  setPostTop,
  setScrollY,
} from '@/lib/postLayout'

function getExpandedPathFromLocation(posts: BlogListPost[]) {
  if (typeof window === 'undefined') {
    return null
  }

  return getExpandedPathFromPathname(posts, window.location.pathname)
}

function stopMotion(control: AnimationPlaybackControls | null) {
  control?.stop()
}

export function useBlogExpansionState({
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
  const pendingInitialContextRef = useRef<BlogMotionContext | null | undefined>(undefined)

  if (pendingInitialContextRef.current === undefined) {
    pendingInitialContextRef.current = initialExpandedPath
      ? consumePendingBlogNavigationMotion(initialExpandedPath)
      : null
  }

  const shouldAnimateInitialExpansion = Boolean(pendingInitialContextRef.current)
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
  const frameRef = useRef<number | null>(null)
  const scrollControlRef = useRef<AnimationPlaybackControls | null>(null)

  const clearMotionTimers = useCallback(() => {
    if (bodyExpansionTimerRef.current !== null) {
      window.clearTimeout(bodyExpansionTimerRef.current)
      bodyExpansionTimerRef.current = null
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    stopMotion(scrollControlRef.current)
    scrollControlRef.current = null
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
    (post: BlogListPost, context: BlogMotionContext) => {
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

      bodyExpansionTimerRef.current = window.setTimeout(complete, animataPostDuration * 1000 + 80)
    },
    [finishExpansion]
  )

  const positionThenExpandPost = useCallback(
    (post: BlogListPost, context: BlogMotionContext) => {
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

      animatePostTopTo(post.path, startTop, targetTop, scrollControlRef, completePositioning)
    },
    [clearMotionTimers, posts, startBodyExpansion]
  )

  const collapsePost = useCallback(
    (post: BlogListPost, context: BlogMotionContext, startTopOverride?: number) => {
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

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null

        flushSync(() => {
          setMotionPhase('collapsing')
        })
        setPostTop(post.path, startTop)

        animatePostTopTo(post.path, startTop, targetTop, scrollControlRef, () => {
          setPostTop(post.path, targetTop)
          flushSync(() => {
            setMotionPhase('idle')
            setMotionPath(null)
          })
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null
            restorePreviousScrollY()
          })
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
    animateScrollTo(0, scrollControlRef)
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
    const postPaths = posts.map((post) => post.path)
    const pendingInitialContext =
      pendingInitialContextRef.current ||
      (nextExpandedPath ? consumePendingBlogNavigationMotion(nextExpandedPath) : null)
    const pendingCollapseContext = nextExpandedPath
      ? null
      : consumePendingBlogCollapseMotion(postPaths) ||
        consumeCurrentBlogListReturnContext(postPaths)

    if (pendingInitialContext && nextExpandedPath) {
      const post = posts.find((item) => item.path === nextExpandedPath)

      pendingInitialContextRef.current = null
      clearMotionTimers()
      setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
      setExpandedPath(null)
      setMotionPath(null)
      setMotionMinHeight(null)
      setMotionPhase('idle')

      if (post) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null
          positionThenExpandPost(post, pendingInitialContext)
        })
      }

      return
    }

    if (pendingCollapseContext) {
      const post = posts.find((item) => item.path === pendingCollapseContext.postPath)

      pendingInitialContextRef.current = null
      clearMotionTimers()
      setExpandedPath(null)
      setMotionPath(null)
      setMotionMinHeight(null)
      setMotionPhase('idle')

      if (post) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null
          collapsePost(post, pendingCollapseContext, getExpandedTargetOffset())
        })
      }

      return
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
    pathname,
    positionThenExpandPost,
    posts,
  ])

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

    return () => window.removeEventListener('popstate', syncExpandedPath)
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
