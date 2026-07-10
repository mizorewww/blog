import BlogWidgetCard from '@/components/BlogWidgetCard'
import Link from '@/components/Link'
import { formatDate } from '@/lib/formatDate'
import { type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

export default function UtilitySidebar({
  posts,
  dateLocale,
  locale,
}: {
  posts: BlogListPost[]
  dateLocale: string
  locale: Locale
}) {
  const labels = ui[locale]

  return (
    <aside className="blog-sidebar-right space-y-5 bg-transparent lg:self-start">
      <BlogWidgetCard title={labels.recentPosts}>
        <div className="dark:divide-border-muted-dark divide-y divide-slate-200">
          {posts.slice(0, 4).map((post) => (
            <Link
              key={post.path}
              href={`/${post.path}/`}
              data-blog-post-link
              className="block py-4 first:pt-0"
            >
              <time
                dateTime={post.date}
                suppressHydrationWarning
                className="block text-sm text-slate-500 dark:text-white/60"
              >
                {formatDate(post.date, dateLocale)}
              </time>
              <span className="mt-2 block text-base leading-7 text-slate-800 hover:text-sky-700 dark:text-white/80 dark:hover:text-sky-300">
                {post.title}
              </span>
            </Link>
          ))}
        </div>
      </BlogWidgetCard>
    </aside>
  )
}
