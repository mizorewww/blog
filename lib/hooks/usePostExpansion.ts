'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { BlogListPost } from '@/lib/listPosts'
import {
  BLOG_PATH_CHANGE_EVENT,
  consumePendingBlogNavigationMotion,
  getBlogListReturnContext,
  isHomePath,
  normalizePathname,
  type BlogMotionContext as MotionContext,
} from '@/lib/blogRouteState'
import {
  MOTION_DURATION,
  animatePostTopTo,
  animateScrollTo,
  getExpandedTargetOffset,
  getMainColumnHeight,
  getPostShell,
  setPostTop,
} from '@/lib/postMotion'

export const POSTS_PER_BATCH = 5

export type MotionPhase = 'idle' | 'expanding' | 'collapsing-prep' | 'collapsing'

export type MotionOptions = {
  afterMotion?: () => void
}

function getExpandedPathFromPathname(posts: BlogListPost[], pathname: string) {
  const currentPath = normalizePathname(decodeURI(pathname))
  const matchingPost = posts.find((post) => normalizePathname(`/${post.path}`) === currentPath)

  return matchingPost?.path || null
}

function getExpandedPathFromLocation(posts: BlogListPost[]) {
  if (typeof window === 'undefined') {
    return null
  }

  return getExpandedPathFromPathname(posts, window.location.pathname)
}

function getInitialVisibleCount(
  posts: BlogListPost[],
  initialDisplayCount: number,
  expandedPath?: string | null
) {
  const expandedIndex = expandedPath ? posts.findIndex((post) => post.path === expandedPath) : -1

  return Math.max(initialDisplayCount || POSTS_PER_BATCH, POSTS_PER_BATCH, expandedIndex + 1)
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
  const scrollFrameRef = useRef<number | null>(null)

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
    (post: BlogListPost, context: MotionContext, options?: MotionOptions) => {
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
          options?.afterMotion?.()
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

  useEffect(() => {
    const nextExpandedPath = getExpandedPathFromPathname(posts, pathname) || initialExpandedPath
    const pendingInitialMotion = pendingInitialMotionRef.current

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
          expandPost(post, pendingInitialMotion)
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
  }, [clearMotionTimers, expandPost, initialDisplayCount, initialExpandedPath, pathname, posts])

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
    collapsePost,
    expandedPath,
    expandPost,
    loadMorePosts,
    motionMinHeight,
    motionPath,
    motionPhase,
    scrollToTop,
    visibleCount,
  }
}
