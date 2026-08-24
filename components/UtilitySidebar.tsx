import BlogWidgetCard from '@/components/BlogWidgetCard'
import ContentTree from '@/components/ContentTree'
import Link from '@/components/Link'
import { widgetCardClass } from '@/components/ui/styles'
import type { ContentTreeNode } from '@/lib/content/contentTree'
import { formatDate } from '@/lib/formatDate'
import { type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

export default function UtilitySidebar({
  posts,
  contentTree,
  dateLocale,
  locale,
}: {
  posts: BlogListPost[]
  contentTree: ContentTreeNode[]
  dateLocale: string
  locale: Locale
}) {
  const labels = ui[locale]

  return (
    <aside className="blog-sidebar-right space-y-5 bg-transparent lg:self-start">
      {contentTree.length > 0 && (
        <section data-content-tree-card className={`${widgetCardClass} px-3 py-3 sm:px-4 sm:py-4`}>
          <ContentTree chrome="sidebar" locale={locale} nodes={contentTree} />
        </section>
      )}
      <BlogWidgetCard title={labels.recentPosts}>
        <div className="divide-y divide-slate-200/75 dark:divide-white/8">
          {posts.slice(0, 4).map((post) => (
            <Link
              key={post.path}
              href={`/${post.path}/`}
              data-blog-post-link
              className="block py-3 first:pt-0"
            >
              <time
                dateTime={post.date}
                suppressHydrationWarning
                className="block text-xs text-slate-500 dark:text-white/55"
              >
                {formatDate(post.date, dateLocale)}
              </time>
              <span className="mt-1.5 block text-sm leading-6 text-slate-700 hover:text-sky-700 dark:text-white/70 dark:hover:text-sky-300">
                {post.title}
              </span>
            </Link>
          ))}
        </div>
      </BlogWidgetCard>
    </aside>
  )
}
