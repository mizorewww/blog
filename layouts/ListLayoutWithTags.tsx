'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'
import BackToTop from '@/components/BackToTop'
import { BlogFrame } from '@/components/BlogWidgets'
import ExpandablePostCard from '@/components/ExpandablePostCard'
import { getCategoryCounts, getTagCounts } from '@/lib/content/terms'
import { usePostExpansion } from '@/lib/hooks/usePostExpansion'
import { defaultLocale, localeConfig, type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

interface ListLayoutProps {
  posts: BlogListPost[]
  title: string
  locale?: Locale
  categoryCounts?: Record<string, number>
  tagCounts?: Record<string, number>
  initialDisplayPosts?: BlogListPost[]
  initialExpandedPath?: string | null
  expandedPostBody?: ReactNode
}

export default function ListLayoutWithTags({
  posts,
  title,
  locale = defaultLocale,
  categoryCounts: providedCategoryCounts,
  tagCounts: providedTagCounts,
  initialDisplayPosts = [],
  initialExpandedPath = null,
  expandedPostBody,
}: ListLayoutProps) {
  const pathname = usePathname()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const categoryCounts = providedCategoryCounts || getCategoryCounts(posts)
  const tagCounts = providedTagCounts || getTagCounts(posts)
  const {
    collapsePost,
    expandedPath,
    expandPost,
    loadMorePosts,
    motionMinHeight,
    motionPath,
    motionPhase,
    scrollToTop,
    visibleCount,
  } = usePostExpansion({
    initialDisplayCount: initialDisplayPosts.length,
    initialExpandedPath,
    pathname,
    posts,
  })
  const displayPosts = posts.slice(0, visibleCount)
  const expandedIndex = expandedPath
    ? displayPosts.findIndex((post) => post.path === expandedPath)
    : -1
  const expandedPost = expandedIndex >= 0 ? displayPosts[expandedIndex] : undefined
  const shouldRenderFullList =
    !expandedPost || motionPhase === 'expanding' || motionPhase.startsWith('collapsing')
  const visiblePosts = shouldRenderFullList ? displayPosts : [expandedPost]
  const motionIndex = motionPath ? displayPosts.findIndex((post) => post.path === motionPath) : -1
  const hasMore = !expandedPath && visibleCount < posts.length

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current

    if (!loadMoreElement || !hasMore) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMorePosts()
        }
      },
      { rootMargin: '240px 0px' }
    )

    observer.observe(loadMoreElement)

    return () => observer.disconnect()
  }, [hasMore, loadMorePosts])

  return (
    <BlogFrame
      posts={posts}
      categoryCounts={categoryCounts}
      tagCounts={tagCounts}
      locale={locale}
      dateLocale={dateLocale}
    >
      <div style={motionMinHeight ? { minHeight: motionMinHeight } : undefined}>
        {!expandedPost && <h1 className="sr-only">{title}</h1>}
        {!visiblePosts.length && (
          <div className="dark:bg-surface-card-dark rounded-[10px] bg-white px-8 py-10 text-slate-600 dark:text-white/70">
            {labels.noPosts}
          </div>
        )}
        {visiblePosts.map((post, index) => {
          const isMotionTarget = post.path === motionPath
          const isCollapsedShell =
            !isMotionTarget && (motionPhase === 'expanding' || motionPhase === 'collapsing-prep')
          const isTransitionTarget =
            isMotionTarget && (motionPhase === 'expanding' || motionPhase === 'collapsing-prep')
          const isBeforeMotionTarget = motionIndex >= 0 && index < motionIndex
          const collapsedTranslate = isBeforeMotionTarget ? '-translate-y-8' : 'translate-y-8'

          return (
            <div
              key={post.path}
              data-post-shell={post.path}
              className={`grid transform-gpu transition-all duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0 ${
                isCollapsedShell
                  ? `mt-0 ${collapsedTranslate} grid-rows-[0fr] opacity-0`
                  : `${index === 0 || isTransitionTarget ? 'mt-0' : 'mt-6'} translate-y-0 grid-rows-[1fr] opacity-100`
              }`}
              aria-hidden={isCollapsedShell || undefined}
            >
              <div className="min-h-0 overflow-hidden">
                <ExpandablePostCard
                  post={post}
                  locale={locale}
                  dateLocale={dateLocale}
                  expanded={expandedPath === post.path}
                  body={expandedPath === post.path ? expandedPostBody : null}
                  onExpandedChange={(expanded, context, options) => {
                    if (expanded) {
                      expandPost(post, context, options)
                      return
                    }

                    collapsePost(post, context)
                  }}
                />
              </div>
            </div>
          )
        })}
        {hasMore && <div ref={loadMoreRef} className="mt-6 h-12" aria-hidden="true" />}
        <BackToTop label={labels.backToTop} onClick={scrollToTop} />
      </div>
    </BlogFrame>
  )
}
