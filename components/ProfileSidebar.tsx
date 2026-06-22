import Image from '@/components/Image'
import Link from '@/components/Link'
import BlogWidgetCard from '@/components/BlogWidgetCard'
import { cardClass } from '@/components/ui/styles'
import siteMetadata from '@/data/siteMetadata'
import type { CountMap } from '@/lib/content/terms'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

function sortedEntries(counts: CountMap) {
  return Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    if (a[0] === b[0]) return 0
    return a[0] > b[0] ? 1 : -1
  })
}

function totalWords(posts: BlogListPost[]) {
  const words = posts.reduce((sum, post) => {
    const readingWords = (post.readingTime as { words?: number } | undefined)?.words
    if (typeof readingWords === 'number') return sum + readingWords
    return sum + `${post.title} ${post.summary || ''}`.replace(/\s+/g, '').length
  }, 0)

  return (words / 10000).toFixed(1)
}

export default function ProfileSidebar({
  posts,
  categoryCounts,
  tagCounts,
  locale,
}: {
  posts: BlogListPost[]
  categoryCounts: CountMap
  tagCounts: CountMap
  locale: Locale
}) {
  const labels = ui[locale]
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
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">{labels.articles}</dd>
          </div>
          <div>
            <dt className="text-2xl text-slate-900 dark:text-white/90">{categories.length}</dt>
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">{labels.categories}</dd>
          </div>
          <div>
            <dt className="text-2xl text-slate-900 dark:text-white/90">{tags.length}</dt>
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">{labels.tags}</dd>
          </div>
          <div>
            <dt className="text-2xl text-slate-900 dark:text-white/90">{totalWords(posts)}</dt>
            <dd className="mt-1 text-sm text-slate-500 dark:text-white/60">{labels.words}</dd>
          </div>
        </dl>
      </section>

      <div className="blog-sidebar-left-sticky space-y-5">
        <BlogWidgetCard title={labels.categories}>
          <div className="space-y-4">
            {categories.length === 0 && (
              <p className="text-slate-500 dark:text-white/60">{labels.noCategories}</p>
            )}
            {categories.slice(0, 8).map(([category, count]) => (
              <Link
                key={category}
                href={localizePath(`/categories/${category}`, locale)}
                className="flex items-center justify-between text-base text-slate-700 transition hover:text-sky-500 dark:text-white/80"
              >
                <span>{category}</span>
                <span className="dark:bg-border-subtle-dark rounded-[10px] bg-slate-200 px-3 py-1 text-sm text-slate-600 dark:text-white/70">
                  {count}
                </span>
              </Link>
            ))}
          </div>
        </BlogWidgetCard>

        <BlogWidgetCard title={labels.popularTags}>
          <div className="flex flex-wrap gap-x-3 gap-y-3 text-base">
            {tags.length === 0 && (
              <p className="text-slate-500 dark:text-white/60">{labels.noTags}</p>
            )}
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
        </BlogWidgetCard>
      </div>
    </aside>
  )
}
