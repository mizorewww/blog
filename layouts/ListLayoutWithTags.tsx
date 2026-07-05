'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import BackToTop from '@/components/BackToTop'
import BlogFrame from '@/components/BlogFrame'
import ExpandablePostCard from '@/components/ExpandablePostCard'
import PostLayoutMotion from '@/components/animata/PostLayoutMotion'
import { getCategoryCounts, getTagCounts, type CountMap } from '@/lib/content/terms'
import { useBlogExpansionState } from '@/lib/hooks/useBlogExpansionState'
import { defaultLocale, localeConfig, type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

interface ListLayoutProps {
  posts: BlogListPost[]
  title: string
  locale?: Locale
  categoryCounts?: CountMap
  tagCounts?: CountMap
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
  const [currentPathname, setCurrentPathname] = useState(pathname)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const categoryCounts = providedCategoryCounts || getCategoryCounts(posts)
  const tagCounts = providedTagCounts || getTagCounts(posts)
  const {
    expandedPath,
    loadMorePosts,
    motionMinHeight,
    motionPath,
    motionPhase,
    scrollToTop,
    visibleCount,
  } = useBlogExpansionState({
    initialDisplayCount: initialDisplayPosts.length,
    initialExpandedPath,
    pathname: currentPathname,
    posts,
  })
  const displayPosts = posts.slice(0, visibleCount)
  const expandedIndex = expandedPath
    ? displayPosts.findIndex((post) => post.path === expandedPath)
    : -1
  const expandedPost = expandedIndex >= 0 ? displayPosts[expandedIndex] : undefined
  const shouldRenderFullList =
    !expandedPost ||
    motionPhase === 'positioning' ||
    motionPhase === 'expanding' ||
    motionPhase.startsWith('collapsing')
  const visiblePosts = shouldRenderFullList ? displayPosts : [expandedPost]
  const motionIndex = motionPath ? displayPosts.findIndex((post) => post.path === motionPath) : -1
  const hasMore =
    motionPhase === 'idle' && !expandedPath && !motionPath && visibleCount < posts.length

  useEffect(() => {
    setCurrentPathname(pathname)
  }, [pathname])

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
      expandedPath={expandedPath}
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
            !isMotionTarget &&
            (motionPhase === 'positioning' ||
              motionPhase === 'expanding' ||
              motionPhase === 'collapsing-prep' ||
              motionPhase === 'collapsing')
          const isTransitionTarget =
            isMotionTarget &&
            (motionPhase === 'positioning' ||
              motionPhase === 'expanding' ||
              motionPhase === 'collapsing-prep')
          const isBeforeMotionTarget = motionIndex >= 0 && index < motionIndex

          return (
            <PostLayoutMotion
              key={post.path}
              postPath={post.path}
              collapsed={isCollapsedShell}
              direction={isBeforeMotionTarget ? 'up' : 'down'}
              isTransitionTarget={isTransitionTarget}
              className={index === 0 ? 'mt-0' : 'mt-6'}
            >
              <ExpandablePostCard
                post={post}
                locale={locale}
                dateLocale={dateLocale}
                expanded={expandedPath === post.path}
                priority={index === 0}
                allPosts={posts}
                body={
                  expandedPath === post.path || motionPath === post.path ? expandedPostBody : null
                }
              />
            </PostLayoutMotion>
          )
        })}
        {hasMore && <div ref={loadMoreRef} className="mt-6 h-12" aria-hidden="true" />}
        <BackToTop label={labels.backToTop} onClick={scrollToTop} />
      </div>
    </BlogFrame>
  )
}
