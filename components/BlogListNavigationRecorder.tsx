'use client'

import { useEffect } from 'react'
import { ARTICLE_RETURN_MARKER_KEY, createArticleReturnMarker } from '@/lib/articleReturn'
import {
  createArticleCardSnapshot,
  type ArticleNavigationIntent,
  type ArticleTransitionRect,
} from '@/lib/articleTransition'

function isPlainPrimaryClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function clearMarker() {
  try {
    window.sessionStorage.removeItem(ARTICLE_RETURN_MARKER_KEY)
  } catch {
    // A storage failure leaves normal Link navigation as the only behavior.
  }
}

export default function BlogListNavigationRecorder({
  onArticleNavigation,
}: {
  onArticleNavigation?: (intent: ArticleNavigationIntent) => void
}) {
  useEffect(() => {
    const recordArticleNavigation = (event: MouseEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const link = target.closest<HTMLAnchorElement>('a[data-blog-post-link]')

      if (!link) {
        return
      }

      if (
        event.defaultPrevented ||
        !isPlainPrimaryClick(event) ||
        (link.target && link.target !== '_self') ||
        link.hasAttribute('download')
      ) {
        clearMarker()
        return
      }

      const marker = createArticleReturnMarker({
        sourceUrl: window.location.href,
        targetUrl: link.href,
        createdAt: Date.now(),
      })

      if (!marker) {
        clearMarker()
        onArticleNavigation?.({ kind: 'cancel' })
        return
      }

      try {
        window.sessionStorage.setItem(ARTICLE_RETURN_MARKER_KEY, JSON.stringify(marker))
      } catch {
        clearMarker()
        onArticleNavigation?.({ kind: 'cancel' })
        return
      }

      const targetUrl = new URL(link.href)
      const card = link.closest<HTMLElement>('[data-article-transition-card]')

      if (!card) {
        onArticleNavigation?.({ kind: 'fallback', targetPath: targetUrl.pathname })
        return
      }

      const cover = card.querySelector<HTMLElement>('[data-article-transition-cover]')
      const image = cover?.querySelector<HTMLImageElement>('img')
      const title = card.querySelector<HTMLElement>('[data-article-transition-title]')
      const gitUpdated = card.querySelector<HTMLElement>('[data-article-transition-git-updated]')
      const gitSource = card.querySelector<HTMLElement>('[data-article-transition-git-source]')
      const summary = card.querySelector<HTMLElement>('[data-article-transition-summary]')
      const publishedDate = card.querySelector<HTMLElement>('[data-article-transition-date]')
      const primaryTag = card.querySelector<HTMLElement>('[data-article-transition-primary-tag]')
      const readMore = card.querySelector<HTMLElement>('[data-article-transition-read-more]')
      const toRect = (rect: DOMRect): ArticleTransitionRect => ({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
      const snapshot = createArticleCardSnapshot(
        {
          key: card.dataset.articleTransitionKey,
          sourcePath: window.location.pathname,
          targetPath: targetUrl.pathname,
          imageSrc: image?.currentSrc || image?.src,
          title: title?.textContent || undefined,
          gitUpdated: gitUpdated?.textContent || '',
          gitSource: gitSource?.textContent || '',
          summary: summary?.textContent || '',
          publishedDate: publishedDate?.textContent || undefined,
          primaryTag: primaryTag?.textContent || '',
          readMore: readMore?.textContent || undefined,
          cardRect: toRect(card.getBoundingClientRect()),
          coverRect: cover ? toRect(cover.getBoundingClientRect()) : undefined,
          radius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius),
        },
        { width: window.innerWidth, height: window.innerHeight }
      )

      onArticleNavigation?.(snapshot ? { kind: 'card', snapshot } : { kind: 'cancel' })
    }

    document.addEventListener('click', recordArticleNavigation, true)

    return () => document.removeEventListener('click', recordArticleNavigation, true)
  }, [onArticleNavigation])

  return null
}
