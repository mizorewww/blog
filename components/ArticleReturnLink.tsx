'use client'

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useArticleTransitionReturn } from '@/components/ArticleTransitionContext'
import Link from '@/components/Link'
import { consumeArticleReturnMarker } from '@/lib/articleReturn'

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export default function ArticleReturnLink({
  ariaLabel,
  children,
  className,
  href,
}: {
  ariaLabel: string
  children: ReactNode
  className?: string
  href: string
}) {
  const [canUseHistoryBack, setCanUseHistoryBack] = useState(false)
  const requestReturnTransition = useArticleTransitionReturn()
  // StrictMode double-runs mount effects in dev. Consuming the marker removes
  // it from storage, so an unguarded second run reads null and flips the state
  // back to false — the return link then falls through to plain navigation.
  const markerConsumedRef = useRef(false)

  useEffect(() => {
    if (markerConsumedRef.current) {
      return
    }

    markerConsumedRef.current = true
    setCanUseHistoryBack(
      consumeArticleReturnMarker(window.sessionStorage, {
        currentUrl: window.location.href,
        documentStartedAt: window.performance.timeOrigin,
        now: Date.now(),
      })
    )
  }, [])

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainPrimaryClick(event) || !canUseHistoryBack) {
      return
    }

    event.preventDefault()
    setCanUseHistoryBack(false)
    // The context owns the history navigation when it accepts the return: the
    // card path defers back() until the overlay's underlay is opaque so the
    // list page never flashes through a half-faded layer. Only navigate here
    // when no transition session handled the click.
    if (!requestReturnTransition?.()) {
      window.history.back()
    }
  }

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      onClick={onClick}
      className={className}
      data-article-transition-destination-only
    >
      {children}
    </Link>
  )
}
