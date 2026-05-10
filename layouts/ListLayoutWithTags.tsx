'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { slug } from 'github-slugger'
import { formatDate } from 'pliny/utils/formatDate'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog } from 'contentlayer/generated'
import Link from '@/components/Link'
import Tag from '@/components/Tag'
import { getTagCounts } from '@/lib/blog'
import { defaultLocale, localeConfig, localizePath, type Locale, ui } from '@/lib/i18n'

interface ListLayoutProps {
  posts: CoreContent<Blog>[]
  title: string
  locale?: Locale
  tagCounts?: Record<string, number>
  initialDisplayPosts?: CoreContent<Blog>[]
}

const POSTS_PER_BATCH = 5

export default function ListLayoutWithTags({
  posts,
  title,
  locale = defaultLocale,
  tagCounts: providedTagCounts,
  initialDisplayPosts = [],
}: ListLayoutProps) {
  const pathname = usePathname()
  const [visibleCount, setVisibleCount] = useState(
    Math.max(initialDisplayPosts.length || POSTS_PER_BATCH, POSTS_PER_BATCH)
  )
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const tagCounts = providedTagCounts || getTagCounts(posts)
  const tagKeys = Object.keys(tagCounts)
  const sortedTags = tagKeys.sort((a, b) => tagCounts[b] - tagCounts[a])

  const displayPosts = posts.slice(0, visibleCount)
  const hasMore = visibleCount < posts.length

  useEffect(() => {
    setVisibleCount(Math.max(initialDisplayPosts.length || POSTS_PER_BATCH, POSTS_PER_BATCH))
  }, [initialDisplayPosts.length, pathname])

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current

    if (!loadMoreElement || !hasMore) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, posts.length))
        }
      },
      { rootMargin: '240px 0px' }
    )

    observer.observe(loadMoreElement)

    return () => observer.disconnect()
  }, [hasMore, posts.length])

  return (
    <>
      <div>
        <div className="pt-6 pb-6">
          <h1 className="text-3xl leading-9 font-extrabold tracking-tight text-gray-900 sm:hidden sm:text-4xl sm:leading-10 md:text-6xl md:leading-14 dark:text-gray-100">
            {title}
          </h1>
        </div>
        <div className="flex sm:space-x-24">
          <div className="hidden h-full max-h-screen max-w-[280px] min-w-[280px] flex-wrap overflow-auto rounded-sm bg-gray-50 pt-5 shadow-md sm:flex dark:bg-gray-900/70 dark:shadow-gray-800/40">
            <div className="px-6 py-4">
              {pathname === localizePath('/blog', locale) ||
              pathname.startsWith(`${localizePath('/blog', locale)}/page/`) ||
              pathname === '/blog' ||
              pathname.startsWith('/blog/page/') ? (
                <h3 className="text-primary-500 font-bold uppercase">{labels.allPosts}</h3>
              ) : (
                <Link
                  href={localizePath('/blog', locale)}
                  className="hover:text-primary-500 dark:hover:text-primary-500 font-bold text-gray-700 uppercase dark:text-gray-300"
                >
                  {labels.allPosts}
                </Link>
              )}
              <ul>
                {sortedTags.map((t) => {
                  return (
                    <li key={t} className="my-3">
                      {decodeURI(pathname.split('/tags/')[1]) === slug(t) ? (
                        <h3 className="text-primary-500 inline px-3 py-2 text-sm font-bold uppercase">
                          {`${t} (${tagCounts[t]})`}
                        </h3>
                      ) : (
                        <Link
                          href={localizePath(`/tags/${slug(t)}`, locale)}
                          className="hover:text-primary-500 dark:hover:text-primary-500 px-3 py-2 text-sm font-medium text-gray-500 uppercase dark:text-gray-300"
                          aria-label={labels.postsTagged(t)}
                        >
                          {`${t} (${tagCounts[t]})`}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
          <div>
            <ul>
              {displayPosts.map((post) => {
                const { path, date, title, summary, tags } = post
                return (
                  <li key={path} className="py-5">
                    <article className="flex flex-col space-y-2 xl:space-y-0">
                      <dl>
                        <dt className="sr-only">{labels.publishedOn}</dt>
                        <dd className="text-base leading-6 font-medium text-gray-500 dark:text-gray-400">
                          <time dateTime={date} suppressHydrationWarning>
                            {formatDate(date, dateLocale)}
                          </time>
                        </dd>
                      </dl>
                      <div className="space-y-3">
                        <div>
                          <h2 className="text-2xl leading-8 font-bold tracking-tight">
                            <Link href={`/${path}`} className="text-gray-900 dark:text-gray-100">
                              {title}
                            </Link>
                          </h2>
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
            {hasMore && <div ref={loadMoreRef} className="h-12" aria-hidden="true" />}
          </div>
        </div>
      </div>
    </>
  )
}
