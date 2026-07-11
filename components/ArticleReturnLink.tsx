'use client'

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
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

  useEffect(() => {
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
    requestReturnTransition?.()
    window.history.back()
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
