import Image from '@/components/Image'
import Link from '@/components/Link'
import BlogWidgetCard from '@/components/BlogWidgetCard'
import { cardClass } from '@/components/ui/styles'
import siteMetadata from '@/data/siteMetadata'
import { getSortedTermSummaries, type CountMap } from '@/lib/content/terms'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

function totalWords(posts: BlogListPost[], locale: Locale) {
  const words = posts.reduce((sum, post) => {
    const readingWords = (post.readingTime as { words?: number } | undefined)?.words
    if (typeof readingWords === 'number') return sum + readingWords
    return sum + `${post.title} ${post.summary || ''}`.replace(/\s+/g, '').length
  }, 0)

  return (locale === 'zh' ? words / 10000 : words / 1000).toFixed(1)
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
  const categories = getSortedTermSummaries(categoryCounts)
  const tags = getSortedTermSummaries(tagCounts)

  return (
    <aside className="blog-sidebar-left space-y-5 bg-transparent">
      <section
        data-profile-card
        className={`${cardClass} px-5 py-5 text-center sm:px-6 sm:py-6 lg:bg-white/82 lg:shadow-[0_0_0_1px_rgba(15,23,42,0.035),0_8px_22px_rgba(21,30,43,0.045)] lg:ring-slate-950/[0.04] lg:dark:bg-white/[0.045] lg:dark:shadow-[0_0_0_1px_rgba(255,255,255,0.045)] lg:dark:ring-white/[0.06]`}
      >
        <Image
          src="/static/images/avatar.png"
          width={84}
          height={84}
          alt={siteMetadata.author}
          className="mx-auto rounded-full"
        />
        <h2 className="mt-4 text-xl font-medium text-slate-900 dark:text-white/86">
          {siteMetadata.author}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-white/64">
          {siteMetadata.description}
        </p>
        <dl className="mt-5 grid grid-cols-4 gap-2 text-center">
          <div>
            <dt className="text-xl text-slate-900 dark:text-white/86">{posts.length}</dt>
            <dd className="mt-1 text-xs text-slate-500 dark:text-white/55">{labels.articles}</dd>
          </div>
          <div>
            <dt className="text-xl text-slate-900 dark:text-white/86">{categories.length}</dt>
            <dd className="mt-1 text-xs text-slate-500 dark:text-white/55">{labels.categories}</dd>
          </div>
          <div>
            <dt className="text-xl text-slate-900 dark:text-white/86">{tags.length}</dt>
            <dd className="mt-1 text-xs text-slate-500 dark:text-white/55">{labels.tags}</dd>
          </div>
          <div>
            <dt className="text-xl text-slate-900 dark:text-white/86">
              {totalWords(posts, locale)}
            </dt>
            <dd className="mt-1 text-xs text-slate-500 dark:text-white/55">{labels.words}</dd>
          </div>
        </dl>
      </section>

      <div className="blog-sidebar-left-sticky space-y-5">
        <BlogWidgetCard title={labels.categories}>
          <div className="space-y-2">
            {categories.length === 0 && (
              <p className="text-slate-500 dark:text-white/60">{labels.noCategories}</p>
            )}
            {categories.slice(0, 8).map((category) => (
              <Link
                key={category.slug}
                href={localizePath(`/categories/${category.slug}`, locale)}
                className="flex min-h-11 items-center justify-between gap-3 rounded-[6px] px-1 text-sm text-slate-600 hover:text-sky-700 dark:text-white/70 dark:hover:text-sky-300"
              >
                <span className="[overflow-wrap:anywhere]">{category.label}</span>
                <span className="rounded-[8px] bg-slate-200/70 px-2 py-0.5 text-xs text-slate-500 dark:bg-white/8 dark:text-white/55">
                  {category.count}
                </span>
              </Link>
            ))}
          </div>
        </BlogWidgetCard>

        <BlogWidgetCard title={labels.popularTags}>
          <div className="flex flex-wrap gap-x-2 gap-y-1.5 text-sm">
            {tags.length === 0 && (
              <p className="text-slate-500 dark:text-white/60">{labels.noTags}</p>
            )}
            {tags.slice(0, 9).map((tag) => (
              <Link
                key={tag.slug}
                href={localizePath(`/tags/${tag.slug}`, locale)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[6px] px-1 text-slate-600 hover:text-sky-700 dark:text-white/68 dark:hover:text-sky-300"
              >
                # {tag.label}
              </Link>
            ))}
          </div>
        </BlogWidgetCard>
      </div>
    </aside>
  )
}
