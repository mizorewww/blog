'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { BlogListPost } from '@/lib/listPosts'
import {
  getExpandedPathFromPathname,
  getInitialVisibleCount,
  POSTS_PER_BATCH,
} from '@/lib/blogExpansionState'

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
  const [expandedPath, setExpandedPath] = useState<string | null>(initialExpandedPath)
  const [visibleCount, setVisibleCount] = useState(
    getInitialVisibleCount(posts, initialDisplayCount, initialExpandedPath)
  )

  const savedScrollYRef = useRef<number | null>(null)
  const expandedPathRef = useRef<string | null>(initialExpandedPath)
  const scrollRestoreTimerRef = useRef<number | null>(null)

  const saveScrollPosition = useCallback(() => {
    savedScrollYRef.current = window.scrollY
  }, [])

  useLayoutEffect(() => {
    const next = getExpandedPathFromPathname(posts, pathname)
    const wasExpanded = expandedPathRef.current !== null
    const isCollapsing = next === null && wasExpanded

    expandedPathRef.current = next
    setExpandedPath(next)
    setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, next))

    // Collapse: delay scroll restore so the CollapsiblePanel exit
    // animation (height auto→0, ~480ms) is visible. The user sees
    // the body collapse and cards shift up, then scroll snaps back.
    if (isCollapsing && savedScrollYRef.current !== null) {
      const y = savedScrollYRef.current

      if (scrollRestoreTimerRef.current) {
        window.clearTimeout(scrollRestoreTimerRef.current)
      }

      scrollRestoreTimerRef.current = window.setTimeout(() => {
        scrollRestoreTimerRef.current = null
        savedScrollYRef.current = null
        const root = document.documentElement
        const prev = root.style.scrollBehavior
        root.style.scrollBehavior = 'auto'
        window.scrollTo(0, y)
        root.style.scrollBehavior = prev
      }, 350)
    }
  }, [pathname, posts, initialDisplayCount])

  const loadMorePosts = useCallback(() => {
    setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, posts.length))
  }, [posts.length])

  const scrollToTop = useCallback(() => {
    const root = document.documentElement
    const prev = root.style.scrollBehavior
    root.style.scrollBehavior = 'smooth'
    window.scrollTo(0, 0)
    root.style.scrollBehavior = prev
  }, [])

  return {
    expandedPath,
    loadMorePosts,
    saveScrollPosition,
    scrollToTop,
    visibleCount,
  }
}
