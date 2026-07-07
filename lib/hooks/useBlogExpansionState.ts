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

  const saveScrollPosition = useCallback(() => {
    savedScrollYRef.current = window.scrollY
  }, [])

  useLayoutEffect(() => {
    const next = getExpandedPathFromPathname(posts, pathname)

    // Collapse: restore scroll before paint. Then re-check after paint
    // in case the browser (mobile Chrome) adjusted the scroll due to
    // the CollapsiblePanel exit animation changing page height.
    if (next === null && expandedPathRef.current !== null && savedScrollYRef.current !== null) {
      const y = savedScrollYRef.current

      // Immediate restore (before paint)
      const root = document.documentElement
      const prev = root.style.scrollBehavior
      root.style.scrollBehavior = 'auto'
      window.scrollTo(0, y)
      root.style.scrollBehavior = prev

      // Delayed re-restore: some mobile browsers adjust the scroll
      // after navigation/render. Re-check after 100ms and fix.
      setTimeout(() => {
        if (Math.abs(window.scrollY - y) > 2) {
          const r = document.documentElement
          const p = r.style.scrollBehavior
          r.style.scrollBehavior = 'auto'
          window.scrollTo(0, y)
          r.style.scrollBehavior = p
        }
        savedScrollYRef.current = null
      }, 100)
    }

    expandedPathRef.current = next
    setExpandedPath(next)
    setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, next))
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
