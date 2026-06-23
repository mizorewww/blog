'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent } from 'react'
import type { Locale } from '@/lib/i18n'
import { localizePath } from '@/lib/i18n'
import {
  clearBlogListReturnContext,
  getStoredBlogListReturnContext,
  setBlogListReturnContext,
  setPendingBlogCollapseMotion,
  setPendingBlogNavigationMotion,
  type BlogMotionContext,
} from '@/lib/blogRouteState'

function getHistoryState() {
  return typeof window.history.state === 'object' && window.history.state !== null
    ? window.history.state
    : {}
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function useExpandablePostNavigation({
  expanded,
  locale,
  postHref,
  postPath,
}: {
  expanded: boolean
  locale: Locale
  postHref: string
  postPath: string
}) {
  const router = useRouter()
  const articleRef = useRef<HTMLElement | null>(null)
  const previousUrlRef = useRef<string | null>(null)
  const previousScrollYRef = useRef<number | null>(null)
  const previousCardTopRef = useRef<number | null>(null)

  const prefetchPost = useCallback(() => {
    router.prefetch(postHref)
  }, [postHref, router])

  const saveReturnContext = useCallback(
    (source: HTMLAnchorElement) => {
      previousUrlRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      previousScrollYRef.current = window.scrollY
      previousCardTopRef.current = source.closest('article')?.getBoundingClientRect().top ?? null

      const expansionContext: BlogMotionContext = {
        previousCardTop: previousCardTopRef.current,
        previousScrollY: previousScrollYRef.current,
        previousUrl: previousUrlRef.current,
      }

      window.history.replaceState(
        {
          ...getHistoryState(),
          blogListReturn: {
            postPath,
            previousCardTop: previousCardTopRef.current,
            previousScrollY: previousScrollYRef.current,
            previousUrl: previousUrlRef.current,
          },
        },
        '',
        previousUrlRef.current
      )
      setBlogListReturnContext(postPath, expansionContext)
      setPendingBlogNavigationMotion(postPath, postHref, expansionContext)
      prefetchPost()
      router.push(postHref, { scroll: false })
    },
    [postHref, postPath, prefetchPost, router]
  )

  const onOpenPost = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainPrimaryClick(event)) {
        return
      }

      event.preventDefault()
      saveReturnContext(event.currentTarget)
    },
    [saveReturnContext]
  )

  useEffect(() => {
    const article = articleRef.current

    if (!article || expanded) {
      return
    }

    if (!('IntersectionObserver' in window)) {
      prefetchPost()
      return
    }

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

  const onReadMore = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainPrimaryClick(event)) {
        return
      }

      event.preventDefault()

      if (expanded) {
        const storedContext = getStoredBlogListReturnContext(postPath)
        const previousUrl =
          previousUrlRef.current || storedContext?.previousUrl || localizePath('/', locale)
        const previousScrollY = previousScrollYRef.current ?? storedContext?.previousScrollY ?? null
        const previousCardTop = previousCardTopRef.current ?? storedContext?.previousCardTop ?? null
        const collapseContext = { previousCardTop, previousScrollY, previousUrl }

        setPendingBlogCollapseMotion(postPath, previousUrl, collapseContext)
        previousUrlRef.current = null
        previousScrollYRef.current = null
        previousCardTopRef.current = null
        clearBlogListReturnContext(postPath)
        router.push(previousUrl, { scroll: false })
        return
      }

      saveReturnContext(event.currentTarget)
    },
    [expanded, locale, postPath, router, saveReturnContext]
  )

  return {
    articleRef,
    onOpenPost,
    onReadMore,
    prefetchPost,
  }
}
