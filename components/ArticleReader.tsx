'use client'

import { useRef, type MouseEvent, type ReactNode } from 'react'
import ReadingProgress from '@/components/ReadingProgress'
import { getSameDocumentFragmentId } from '@/lib/articleFragment'

function isPlainPrimaryClick(event: MouseEvent<HTMLElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function navigateToArticleFragment(event: MouseEvent<HTMLElement>) {
  const eventTarget = event.target

  if (event.defaultPrevented || !isPlainPrimaryClick(event) || !(eventTarget instanceof Element)) {
    return
  }

  const link = eventTarget.closest<HTMLAnchorElement>('a[href]')

  if (
    !link ||
    !event.currentTarget.contains(link) ||
    (link.target && link.target !== '_self') ||
    link.hasAttribute('download')
  ) {
    return
  }

  const fragmentId = getSameDocumentFragmentId(link.href, window.location.href)
  const fragmentTarget = fragmentId ? document.getElementById(fragmentId) : null

  if (!fragmentTarget) {
    return
  }

  event.preventDefault()
  window.history.replaceState(window.history.state, '', link.href)
  fragmentTarget.scrollIntoView({ behavior: 'auto', block: 'start' })
}

export default function ArticleReader({ children }: { children: ReactNode }) {
  const articleRef = useRef<HTMLElement | null>(null)

  return (
    <>
      <ReadingProgress targetRef={articleRef} />
      <article
        ref={articleRef}
        className="article-reading-grid"
        data-article-reader
        onClickCapture={navigateToArticleFragment}
      >
        {children}
      </article>
    </>
  )
}
