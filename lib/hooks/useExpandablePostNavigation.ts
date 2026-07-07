'use client'

import { useCallback, useEffect, useRef, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/lib/i18n'
import { localizePath } from '@/lib/i18n'
import {
  setPendingBlogCollapseMotion,
  setPendingBlogNavigationMotion,
  type BlogMotionContext,
} from '@/lib/blogRouteState'

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function useExpandablePostNavigation({
  expanded,
  locale,
  postHref,
  onSaveScroll,
}: {
  expanded: boolean
  locale: Locale
  postHref: string
  onSaveScroll: () => void
}) {
  const router = useRouter()
  const articleRef = useRef<HTMLElement | null>(null)

  const prefetchPost = useCallback(() => {
    router.prefetch(postHref)
  }, [postHref, router])

  const navigateToPost = useCallback(() => {
    onSaveScroll()
    // Set pending motion so PageTransition suppresses itself during
    // article expansion (SPA navigation, not a page change).
    const context: BlogMotionContext = {
      previousCardTop: null,
      previousScrollY: window.scrollY,
      previousUrl: window.location.pathname,
    }
    setPendingBlogNavigationMotion(postHref, postHref, context)
    prefetchPost()
    router.push(postHref, { scroll: false })
  }, [onSaveScroll, postHref, prefetchPost, router])

  const navigateBack = useCallback(() => {
    const listUrl = localizePath('/', locale)
    // Set pending collapse motion so PageTransition suppresses itself.
    setPendingBlogCollapseMotion(postHref, listUrl, {
      previousCardTop: null,
      previousScrollY: null,
      previousUrl: null,
    })
    router.push(listUrl, { scroll: false })
  }, [locale, postHref, router])

  const onOpenPost = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainPrimaryClick(event)) return
      event.preventDefault()
      navigateToPost()
    },
    [navigateToPost]
  )

  const onReadMore = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainPrimaryClick(event)) return
      event.preventDefault()
      if (expanded) {
        navigateBack()
      } else {
        navigateToPost()
      }
    },
    [expanded, navigateBack, navigateToPost]
  )

  useEffect(() => {
    const article = articleRef.current
    if (!article || expanded) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          prefetchPost()
          observer.disconnect()
        }
      },
      { rootMargin: '360px 0px' }
    )
    observer.observe(article)
    return () => observer.disconnect()
  }, [expanded, prefetchPost])

  return { articleRef, onOpenPost, onReadMore, prefetchPost }
}
