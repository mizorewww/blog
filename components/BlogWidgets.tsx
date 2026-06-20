import Link from '@/components/Link'
import siteMetadata from '@/data/siteMetadata'
import Image from '@/components/Image'
import type { BlogListPost } from '@/lib/listPosts'
import { localizePath, type Locale } from '@/lib/i18n'
import { slug } from 'github-slugger'
import { formatDate } from '@/lib/formatDate'
import type { ReactNode } from 'react'

type Post = BlogListPost
type CountMap = Record<string, number>

const cardClass =
  'rounded-[8px] bg-white shadow-[0_14px_36px_rgba(21,30,43,0.07)] dark:bg-[#252d38] dark:shadow-none'
const widgetCardClass =
  'overflow-hidden rounded-[8px] bg-white shadow-[0_6px_18px_rgba(21,30,43,0.045)] ring-1 ring-slate-200/70 dark:bg-[#252d38] dark:shadow-none dark:ring-white/10'

function countTerms(posts: Post[], field: 'categories' | 'tags'): CountMap {
  return posts.reduce<CountMap>((counts, post) => {
    post[field]?.forEach((term) => {
      const key = slug(term)
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  }, {})
}

export function countCategories(posts: Post[]): CountMap {
  return countTerms(posts, 'categories')
}

export function countTags(posts: Post[]): CountMap {
  return countTerms(posts, 'tags')
}

export function archiveCounts(posts: Pick<Post, 'date'>[]): CountMap {
  return posts.reduce<CountMap>((counts, post) => {
    const year = new Date(post.date).getFullYear().toString()
    counts[year] = (counts[year] || 0) + 1
    return counts
  }, {})
}

function sortedEntries(counts: CountMap) {
  return Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    if (a[0] === b[0]) return 0
    return a[0] > b[0] ? 1 : -1
  })
}

function totalWords(posts: Post[]) {
  const words = posts.reduce((sum, post) => {
    const readingWords = (post.readingTime as { words?: number } | undefined)?.words
    if (typeof readingWords === 'number') return sum + readingWords
    return sum + `${post.title} ${post.summary || ''}`.replace(/\s+/g, '').length
  }, 0)

  return (words / 10000).toFixed(1)
}

function Widget({
  title,
  children,
  className = '',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${widgetCardClass} px-5 py-5 sm:px-6 sm:py-6 ${className}`}>
      <h2 className="mb-5 text-base font-medium text-slate-500 dark:text-white/60">{title}</h2>
      {children}
    </section>
  )
}

export function ProfileSidebar({
  posts,
  categoryCounts,
  tagCounts,
  locale,
}: {
  posts: Post[]
  categoryCounts: CountMap
  tagCounts: CountMap
  locale: Locale
}) {
  const categories = sortedEntries(categoryCounts)
  const tags = sortedEntries(tagCounts)

  return (
    <aside className="blog-sidebar-left space-y-5 bg-transparent">
      <section className={`${cardClass} px-5 py-6 text-center sm:px-6 sm:py-7`}>
        <Image
          src="/static/images/avatar.png"
          width={96}
          height={96}
          alt={siteMetadata.author}
          className="mx-auto rounded-full"
        />
        <h2 className="mt-5 text-2xl font-medium text-slate-900 dark:text-white/90">
          {siteMetadata.author}
        </h2>
        <p className="mt-3 text-base leading-7 text-slate-600 dark:text-white/70">
          {siteMetadata.description}
        </p>
        <dl className="mt-6 grid grid-cols-4 gap-2 text-center">
          <div>
            <dt className="text-2xl text-slate-900 dark:text-white/90">{posts.length}</dt>
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">文章</dd>
          </div>
          <div>
            <dt className="text-2xl text-slate-900 dark:text-white/90">{categories.length}</dt>
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">分类</dd>
          </div>
          <div>
            <dt className="text-2xl text-slate-900 dark:text-white/90">{tags.length}</dt>
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">标签</dd>
          </div>
          <div>
            <dt className="text-2xl text-slate-900 dark:text-white/90">{totalWords(posts)}</dt>
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">万字</dd>
          </div>
        </dl>
      </section>

      <div className="blog-sidebar-left-sticky space-y-5">
        <Widget title="分类">
          <div className="space-y-4">
            {categories.length === 0 && (
              <p className="text-slate-500 dark:text-white/60">暂无分类</p>
            )}
            {categories.slice(0, 8).map(([category, count]) => (
              <Link
                key={category}
                href={localizePath(`/categories/${category}`, locale)}
                className="flex items-center justify-between text-base text-slate-700 transition hover:text-sky-500 dark:text-white/80"
              >
                <span>{category}</span>
                <span className="rounded-[10px] bg-slate-200 px-3 py-1 text-sm text-slate-600 dark:bg-[#405064] dark:text-white/70">
                  {count}
                </span>
              </Link>
            ))}
          </div>
        </Widget>

        <Widget title="热门标签">
          <div className="flex flex-wrap gap-x-3 gap-y-3 text-base">
            {tags.length === 0 && <p className="text-slate-500 dark:text-white/60">暂无标签</p>}
            {tags.slice(0, 9).map(([tag]) => (
              <Link
                key={tag}
                href={localizePath(`/tags/${tag}`, locale)}
                className="text-slate-700 transition hover:text-sky-500 dark:text-white/80"
              >
                # {tag}
              </Link>
            ))}
          </div>
        </Widget>
      </div>
    </aside>
  )
}

export function UtilitySidebar({
  posts,
  locale,
  dateLocale,
}: {
  posts: Post[]
  locale: Locale
  dateLocale: string
}) {
  const years = Object.entries(archiveCounts(posts)).sort((a, b) => Number(b[0]) - Number(a[0]))

  return (
    <aside className="blog-sidebar-right space-y-5 bg-transparent lg:self-start">
      <Widget title="最近文章">
        <div className="divide-y divide-slate-200 dark:divide-[#415064]">
          {posts.slice(0, 4).map((post) => (
            <Link key={post.path} href={`/${post.path}`} className="block py-4 first:pt-0">
              <time
                dateTime={post.date}
                suppressHydrationWarning
                className="block text-sm text-slate-500 dark:text-white/60"
              >
                {formatDate(post.date, dateLocale)}
              </time>
              <span className="mt-2 block text-base leading-7 text-slate-800 transition hover:text-sky-500 dark:text-white/80">
                {post.title}
              </span>
            </Link>
          ))}
        </div>
      </Widget>

      <Widget title="归档">
        <div className="space-y-4">
          {years.length === 0 && <p className="text-slate-500 dark:text-white/60">暂无归档</p>}
          {years.map(([year, count]) => (
            <Link
              key={year}
              href={localizePath('/blog', locale)}
              className="flex items-center justify-between text-base text-slate-700 transition hover:text-sky-500 dark:text-white/80"
            >
              <span>{year}</span>
              <span className="rounded-[10px] bg-slate-200 px-3 py-1 text-sm text-slate-600 dark:bg-[#405064] dark:text-white/70">
                {count}
              </span>
            </Link>
          ))}
        </div>
      </Widget>
    </aside>
  )
}

export function BlogFrame({
  posts,
  categoryCounts,
  tagCounts,
  locale,
  dateLocale,
  children,
}: {
  posts: Post[]
  categoryCounts: CountMap
  tagCounts: CountMap
  locale: Locale
  dateLocale: string
  children: ReactNode
}) {
  return (
    <div className="blog-frame mx-auto grid w-full gap-y-6 px-3 pt-4 pb-14 sm:px-5 sm:pt-6 lg:px-0">
      <div className="blog-main-column">{children}</div>
      <ProfileSidebar
        posts={posts}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
        locale={locale}
      />
      <UtilitySidebar posts={posts} locale={locale} dateLocale={dateLocale} />
    </div>
  )
}
