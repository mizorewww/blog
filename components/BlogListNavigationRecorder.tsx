'use client'

import { useEffect } from 'react'
import { ARTICLE_RETURN_MARKER_KEY, createArticleReturnMarker } from '@/lib/articleReturn'
import {
  createArticleCardSnapshot,
  type ArticleNavigationIntent,
  type ArticleTransitionRect,
} from '@/lib/articleTransition'
import { isBlogPostPath } from '@/lib/blogRouteState'
import { parseContentTreeNodes } from '@/lib/content/contentTree'
import { createContentTreeSnapshot } from '@/lib/contentTreeTransition'

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

      if (marker) {
        try {
          window.sessionStorage.setItem(ARTICLE_RETURN_MARKER_KEY, JSON.stringify(marker))
        } catch {
          clearMarker()
          onArticleNavigation?.({ kind: 'cancel' })
          return
        }
      } else {
        clearMarker()
      }

      const targetUrl = new URL(link.href)
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const toRect = (rect: DOMRect): ArticleTransitionRect => ({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
      const treeRoot = link.closest<HTMLElement>('[data-content-tree]')
      const card = link.closest<HTMLElement>('[data-article-transition-card]')
      const sourceIsArticle = isBlogPostPath(window.location.pathname)
      const targetIsArticle = isBlogPostPath(targetUrl.pathname)

      const readTreeSnapshot = (root: HTMLElement) => {
        let nodes: ReturnType<typeof parseContentTreeNodes> = null

        try {
          nodes = parseContentTreeNodes(JSON.parse(root.dataset.contentTreePayload || 'null'))
        } catch {
          nodes = null
        }

        const chrome =
          root.dataset.contentTreeChrome === 'rail' || root.dataset.contentTreeChrome === 'sidebar'
            ? root.dataset.contentTreeChrome
            : undefined
        // Measure the visible card container (the sidebar widget card / the
        // article rail box), not the bare nav, so the overlay's background
        // rectangle lands exactly on the real one.
        const container =
          chrome === 'rail'
            ? root.closest<HTMLElement>('[data-article-content-tree]')
            : root.closest<HTMLElement>('section')
        const openFolderPaths = Array.from(
          root.querySelectorAll<HTMLElement>('[data-content-tree-open="true"]')
        )
          .map((folder) => folder.dataset.contentTreeFolder)
          .filter((path): path is string => typeof path === 'string' && path.length > 0)

        return createContentTreeSnapshot(
          {
            sourcePath: window.location.pathname,
            targetPath: targetUrl.pathname,
            nodes: nodes ?? undefined,
            sourceRect: toRect((container ?? root).getBoundingClientRect()),
            chrome,
            openFolderPaths,
          },
          viewport
        )
      }

      if (treeRoot && sourceIsArticle && targetIsArticle) {
        const surface = document.querySelector<HTMLElement>('[data-article-surface]')

        onArticleNavigation?.(
          surface
            ? {
                kind: 'article-switch',
                targetPath: targetUrl.pathname,
                surfaceRect: toRect(surface.getBoundingClientRect()),
              }
            : { kind: 'cancel' }
        )
        return
      }

      if (treeRoot && targetIsArticle) {
        const tree = readTreeSnapshot(treeRoot)

        onArticleNavigation?.(
          tree ? { kind: 'tree-open', tree, targetPath: targetUrl.pathname } : { kind: 'cancel' }
        )
        return
      }

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
        viewport
      )
      const visibleTree = document.querySelector<HTMLElement>('[data-content-tree]')
      const tree = visibleTree ? readTreeSnapshot(visibleTree) : null

      onArticleNavigation?.(
        snapshot ? { kind: 'card', snapshot, tree: tree ?? undefined } : { kind: 'cancel' }
      )
    }

    document.addEventListener('click', recordArticleNavigation, true)

    return () => document.removeEventListener('click', recordArticleNavigation, true)
  }, [onArticleNavigation])

  return null
}
