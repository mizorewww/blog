'use client'

import { useEffect, useRef, useState } from 'react'
import { formatDate } from 'pliny/utils/formatDate'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog } from 'contentlayer/generated'
import Link from '@/components/Link'
import Tag from '@/components/Tag'
import { defaultLocale, localeConfig, type Locale, ui } from '@/lib/i18n'

interface ListLayoutProps {
  posts: CoreContent<Blog>[]
  title: string
  locale?: Locale
  initialDisplayPosts?: CoreContent<Blog>[]
}

const POSTS_PER_BATCH = 5

export default function ListLayout({
  posts,
  title,
  locale = defaultLocale,
  initialDisplayPosts = [],
}: ListLayoutProps) {
  const [searchValue, setSearchValue] = useState('')
  const [visibleCount, setVisibleCount] = useState(
    Math.max(initialDisplayPosts.length || POSTS_PER_BATCH, POSTS_PER_BATCH)
  )
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const filteredBlogPosts = posts.filter((post) => {
    const searchContent = `${post.title} ${post.summary || ''} ${post.tags?.join(' ') || ''}`
    return searchContent.toLowerCase().includes(searchValue.toLowerCase())
  })
  const displayPosts = filteredBlogPosts.slice(0, visibleCount)
  const hasMore = visibleCount < filteredBlogPosts.length

  useEffect(() => {
    setVisibleCount(Math.max(initialDisplayPosts.length || POSTS_PER_BATCH, POSTS_PER_BATCH))
  }, [initialDisplayPosts.length, searchValue])

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current

    if (!loadMoreElement || !hasMore) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, filteredBlogPosts.length))
        }
      },
      { rootMargin: '240px 0px' }
    )

    observer.observe(loadMoreElement)

    return () => observer.disconnect()
  }, [filteredBlogPosts.length, hasMore])

  return (
    <>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        <div className="space-y-2 pt-6 pb-8 md:space-y-5">
          <h1 className="text-3xl leading-9 font-extrabold tracking-tight text-gray-900 sm:text-4xl sm:leading-10 md:text-6xl md:leading-14 dark:text-gray-100">
            {title}
          </h1>
          <div className="relative max-w-lg">
            <label>
              <span className="sr-only">{labels.searchArticles}</span>
              <input
                aria-label={labels.searchArticles}
                type="text"
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={labels.searchArticles}
                className="focus:border-primary-500 focus:ring-primary-500 block w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-900 dark:border-gray-900 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
            <svg
              className="absolute top-3 right-3 h-5 w-5 text-gray-400 dark:text-gray-300"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>
        <ul>
          {!filteredBlogPosts.length && labels.noPosts}
          {displayPosts.map((post) => {
            const { path, date, title, summary, tags } = post
            return (
              <li key={path} className="py-4">
                <article className="space-y-2 xl:grid xl:grid-cols-4 xl:items-baseline xl:space-y-0">
                  <dl>
                    <dt className="sr-only">{labels.publishedOn}</dt>
                    <dd className="text-base leading-6 font-medium text-gray-500 dark:text-gray-400">
                      <time dateTime={date}>{formatDate(date, dateLocale)}</time>
                    </dd>
                  </dl>
                  <div className="space-y-3 xl:col-span-3">
                    <div>
                      <h3 className="text-2xl leading-8 font-bold tracking-tight">
                        <Link href={`/${path}`} className="text-gray-900 dark:text-gray-100">
                          {title}
                        </Link>
                      </h3>
                      <div className="flex flex-wrap">
                        {tags?.map((tag) => (
                          <Tag key={tag} text={tag} locale={locale} />
                        ))}
                      </div>
                    </div>
                    <div className="prose max-w-none text-gray-500 dark:text-gray-400">
                      {summary}
                    </div>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      </div>
      {hasMore && <div ref={loadMoreRef} className="h-12" aria-hidden="true" />}
    </>
  )
}
