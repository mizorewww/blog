'use client'

import { useEffect } from 'react'
import { ARTICLE_RETURN_MARKER_KEY, createArticleReturnMarker } from '@/lib/articleReturn'

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
  onArticleNavigation?: () => void
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
        return
      }

      try {
        window.sessionStorage.setItem(ARTICLE_RETURN_MARKER_KEY, JSON.stringify(marker))
      } catch {
        // The Link remains fully functional when storage is unavailable.
      }

      onArticleNavigation?.()
    }

    document.addEventListener('click', recordArticleNavigation, true)

    return () => document.removeEventListener('click', recordArticleNavigation, true)
  }, [onArticleNavigation])

  return null
}
