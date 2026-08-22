'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import BackToTop from '@/components/BackToTop'
import BlogFrame from '@/components/BlogFrame'
import PostCard from '@/components/PostCard'
import type { ContentTreeNode } from '@/lib/content/contentTree'
import { getCategoryCounts, getTagCounts, type CountMap } from '@/lib/content/terms'
import { defaultLocale, localeConfig, type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

const POSTS_PER_BATCH = 5

interface ListLayoutProps {
  posts: BlogListPost[]
  contentTree: ContentTreeNode[]
  title: string
  visibleTitle?: string
  locale?: Locale
  categoryCounts?: CountMap
  tagCounts?: CountMap
}

export default function ListLayoutWithTags({
  posts,
  contentTree,
  title,
  visibleTitle,
  locale = defaultLocale,
  categoryCounts: providedCategoryCounts,
  tagCounts: providedTagCounts,
}: ListLayoutProps) {
  const [visibleCount, setVisibleCount] = useState(POSTS_PER_BATCH)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const shouldReduceMotion = useReducedMotion()
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const categoryCounts = providedCategoryCounts || getCategoryCounts(posts)
  const tagCounts = providedTagCounts || getTagCounts(posts)
  const displayPosts = posts.slice(0, visibleCount)
  const hasMore = visibleCount < posts.length
  const heading = visibleTitle || title

  const loadMorePosts = useCallback(() => {
    setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, posts.length))
  }, [posts.length])

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: shouldReduceMotion ? 'auto' : 'smooth' })
  }, [shouldReduceMotion])

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
      contentTree={contentTree}
      categoryCounts={categoryCounts}
      tagCounts={tagCounts}
      locale={locale}
      dateLocale={dateLocale}
    >
      <div>
        <h1
          data-list-page-heading={visibleTitle ? 'visible' : 'hidden'}
          className={
            visibleTitle
              ? 'mb-4 text-2xl leading-tight font-semibold tracking-tight text-slate-900 sm:mb-5 sm:text-3xl dark:text-white/90'
              : 'sr-only'
          }
        >
          {heading}
        </h1>
        {!displayPosts.length && (
          <div className="dark:bg-surface-card-dark rounded-[8px] bg-white px-8 py-10 text-slate-600 dark:text-white/70">
            {labels.noPosts}
          </div>
        )}
        {displayPosts.map((post, index) => (
          <div key={post.path} className={index === 0 ? 'mt-0' : 'mt-4 sm:mt-6'}>
            <PostCard post={post} locale={locale} dateLocale={dateLocale} priority={index === 0} />
          </div>
        ))}
        {hasMore && <div ref={loadMoreRef} className="mt-6 h-12" aria-hidden="true" />}
        <BackToTop label={labels.backToTop} onClick={scrollToTop} />
      </div>
    </BlogFrame>
  )
}
