'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BlogListPost } from '@/lib/listPosts'
import {
  getExpandedPathFromPathname,
  getInitialVisibleCount,
  POSTS_PER_BATCH,
} from '@/lib/blogExpansionState'
import {
  consumeCurrentBlogListReturnContext,
  consumePendingBlogCollapseMotion,
  consumePendingBlogNavigationMotion,
  type BlogMotionContext,
  type PendingBlogCollapseMotion,
} from '@/lib/blogRouteState'
import {
  getExpandedTargetOffset,
  restorePostListPosition,
  setPostTop,
  setScrollY,
} from '@/lib/postLayout'

function getExpandedPathFromLocation(posts: BlogListPost[]) {
  if (typeof window === 'undefined') {
    return null
  }

  return getExpandedPathFromPathname(posts, window.location.pathname)
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
  const frameRef = useRef<number | null>(null)

  if (pendingInitialContextRef.current === undefined) {
    pendingInitialContextRef.current = initialExpandedPath
      ? consumePendingBlogNavigationMotion(initialExpandedPath)
      : null
  }

  const [visibleCount, setVisibleCount] = useState(
    getInitialVisibleCount(posts, initialDisplayCount, initialExpandedPath)
  )
  const [expandedPath, setExpandedPath] = useState<string | null>(initialExpandedPath)

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const scheduleExpandedPosition = useCallback(
    (postPath: string) => {
      cancelFrame()
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        setPostTop(postPath, getExpandedTargetOffset())
      })
    },
    [cancelFrame]
  )

  const scheduleListRestore = useCallback(
    (context: PendingBlogCollapseMotion) => {
      cancelFrame()
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        restorePostListPosition(context)
      })
    },
    [cancelFrame]
  )

  const loadMorePosts = useCallback(() => {
    setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, posts.length))
  }, [posts.length])

  const scrollToTop = useCallback(() => {
    cancelFrame()
    setScrollY(0)
  }, [cancelFrame])

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

    pendingInitialContextRef.current = null
    cancelFrame()
    setVisibleCount(
      getInitialVisibleCount(
        posts,
        initialDisplayCount,
        nextExpandedPath || pendingCollapseContext?.postPath
      )
    )
    setExpandedPath(nextExpandedPath)

    if (pendingInitialContext && nextExpandedPath) {
      scheduleExpandedPosition(nextExpandedPath)
      return
    }

    if (pendingCollapseContext) {
      scheduleListRestore(pendingCollapseContext)
    }
  }, [
    cancelFrame,
    initialDisplayCount,
    pathname,
    posts,
    scheduleExpandedPosition,
    scheduleListRestore,
  ])

  useEffect(() => {
    const syncExpandedPath = () => {
      const nextExpandedPath = getExpandedPathFromLocation(posts)
      setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
      setExpandedPath(nextExpandedPath)
    }

    window.addEventListener('popstate', syncExpandedPath)

    return () => window.removeEventListener('popstate', syncExpandedPath)
  }, [initialDisplayCount, posts])

  useEffect(() => {
    return () => cancelFrame()
  }, [cancelFrame])

  return {
    expandedPath,
    loadMorePosts,
    scrollToTop,
    visibleCount,
  }
}
