'use client'

import { useMemo, useState } from 'react'
import { countTags } from '@/components/BlogWidgets'
import ExpandablePostCard from '@/components/ExpandablePostCard'
import type { BlogListPost } from '@/lib/listPosts'
import { defaultLocale, localeConfig, type Locale, ui } from '@/lib/i18n'

export default function SearchPanel({
  posts,
  locale = defaultLocale,
}: {
  posts: BlogListPost[]
  locale?: Locale
}) {
  const [query, setQuery] = useState('')
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const tags = Object.keys(countTags(posts)).slice(0, 8)
  const normalizedQuery = query.trim().toLowerCase()

  const results = useMemo(() => {
    if (!normalizedQuery) return posts

    return posts.filter((post) => {
      const content = `${post.title} ${post.summary || ''} ${post.categories?.join(' ') || ''} ${post.tags?.join(' ') || ''}`
      return content.toLowerCase().includes(normalizedQuery)
    })
  }, [normalizedQuery, posts])
  const expandedIndex = expandedPath ? results.findIndex((post) => post.path === expandedPath) : -1
  const expandedPost = expandedIndex >= 0 ? results[expandedIndex] : undefined
  const visibleResults = expandedPost ? [expandedPost] : results

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-10 pb-16 sm:px-6 lg:pt-20">
      <section className="rounded-[10px] bg-white px-5 py-6 shadow-[0_18px_45px_rgba(21,30,43,0.08)] sm:px-8 sm:py-8 dark:bg-[#252d38] dark:shadow-none">
        <label className="block">
          <span className="sr-only">{labels.searchArticles}</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setExpandedPath(null)
            }}
            placeholder={labels.searchArticles}
            className="block w-full rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-900 transition outline-none placeholder:text-slate-400 focus:border-sky-400 focus:bg-white dark:border-[#405064] dark:bg-[#181c27] dark:text-white/90 dark:placeholder:text-white/40 dark:focus:border-sky-500"
          />
        </label>
        {tags.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-3">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setQuery(tag)
                  setExpandedPath(null)
                }}
                className="rounded-[8px] bg-slate-100 px-4 py-2 text-slate-600 transition hover:bg-sky-500 hover:text-white dark:bg-[#354254] dark:text-white/75 dark:hover:bg-sky-500"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 space-y-8">
        {visibleResults.map((post) => (
          <ExpandablePostCard
            key={post.path}
            post={post}
            locale={locale}
            dateLocale={dateLocale}
            expanded={expandedPath === post.path}
            onExpandedChange={(expanded) => setExpandedPath(expanded ? post.path : null)}
          />
        ))}
        {!visibleResults.length && (
          <div className="rounded-[10px] bg-white px-8 py-10 text-slate-600 dark:bg-[#252d38] dark:text-white/70">
            {labels.noPosts}
          </div>
        )}
      </div>
    </div>
  )
}
