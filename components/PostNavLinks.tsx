import Link from '@/components/Link'
import { cardClass, mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { formatDate } from '@/lib/formatDate'

export default function PostNavLinks({
  currentPost,
  allPosts,
  locale,
  dateLocale,
}: {
  currentPost: BlogListPost
  allPosts: BlogListPost[]
  locale: Locale
  dateLocale: string
}) {
  const labels = ui[locale]
  const index = allPosts.findIndex((post) => post.path === currentPost.path)

  if (index < 0) return null

  // Posts are sorted newest-first: prev = older (index+1), next = newer (index-1)
  const prevPost = index + 1 < allPosts.length ? allPosts[index + 1] : null
  const nextPost = index - 1 >= 0 ? allPosts[index - 1] : null

  if (!prevPost && !nextPost) return null

  return (
    <nav
      aria-label={labels.previousArticle}
      className={`not-prose mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2`}
    >
      {prevPost ? (
        <Link
          href={`/${prevPost.path}/`}
          aria-label={labels.previousPost(prevPost.title)}
          className={`${cardClass} group flex flex-col gap-1 px-5 py-4 hover:border-sky-300 dark:hover:border-sky-700`}
        >
          <span className={`text-xs tracking-wide uppercase ${mutedText}`}>
            {labels.previousArticle}
          </span>
          <span className="font-medium text-slate-900 group-hover:text-sky-700 dark:text-white/90 dark:group-hover:text-sky-300">
            {prevPost.title}
          </span>
          <time
            dateTime={prevPost.date}
            suppressHydrationWarning
            className={`text-sm ${mutedText}`}
          >
            {formatDate(prevPost.date, dateLocale)}
          </time>
        </Link>
      ) : (
        <div className="hidden sm:block" />
      )}
      {nextPost ? (
        <Link
          href={`/${nextPost.path}/`}
          aria-label={labels.nextPost(nextPost.title)}
          className={`${cardClass} group flex flex-col gap-1 px-5 py-4 text-right hover:border-sky-300 sm:text-right dark:hover:border-sky-700`}
        >
          <span className={`text-xs tracking-wide uppercase ${mutedText}`}>
            {labels.nextArticle}
          </span>
          <span className="font-medium text-slate-900 group-hover:text-sky-700 dark:text-white/90 dark:group-hover:text-sky-300">
            {nextPost.title}
          </span>
          <time
            dateTime={nextPost.date}
            suppressHydrationWarning
            className={`text-sm ${mutedText}`}
          >
            {formatDate(nextPost.date, dateLocale)}
          </time>
        </Link>
      ) : (
        <div className="hidden sm:block" />
      )}
    </nav>
  )
}
