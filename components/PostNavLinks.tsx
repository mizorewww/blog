import Link from '@/components/Link'
import { mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'
import type { PostNavItem } from '@/lib/listPosts'

export default function PostNavLinks({
  previousPost,
  nextPost,
  locale,
}: {
  previousPost: PostNavItem | null
  nextPost: PostNavItem | null
  locale: Locale
}) {
  const labels = ui[locale]

  if (!previousPost && !nextPost) {
    return null
  }

  return (
    <nav
      aria-label={labels.previousArticle}
      className="article-post-nav not-prose flex flex-col gap-4 border-t border-slate-200 pt-6 sm:flex-row sm:items-stretch sm:justify-between dark:border-white/10"
    >
      {previousPost && (
        <Link
          href={`/${previousPost.path}/`}
          aria-label={labels.previousPost(previousPost.title)}
          className="group flex min-w-0 flex-col gap-1 sm:flex-1"
        >
          <span className={`text-xs ${mutedText}`}>← {labels.previousArticle}</span>
          <span className="font-medium text-slate-700 transition-colors duration-200 group-hover:text-sky-700 dark:text-white/80 dark:group-hover:text-sky-300">
            {previousPost.title}
          </span>
        </Link>
      )}
      {nextPost && (
        <Link
          href={`/${nextPost.path}/`}
          aria-label={labels.nextPost(nextPost.title)}
          className="group flex min-w-0 flex-col items-start gap-1 text-left sm:flex-1 sm:items-end sm:text-right"
        >
          <span className={`text-xs ${mutedText}`}>{labels.nextArticle} →</span>
          <span className="font-medium text-slate-700 transition-colors duration-200 group-hover:text-sky-700 dark:text-white/80 dark:group-hover:text-sky-300">
            {nextPost.title}
          </span>
        </Link>
      )}
    </nav>
  )
}
