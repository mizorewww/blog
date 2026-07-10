import ArticleGitMeta from '@/components/ArticleGitMeta'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import { MetaItem } from '@/components/PostMeta'
import ResponsiveImage from '@/components/ResponsiveImage'
import { cardClass, mutedText, skyLink } from '@/components/ui/styles'
import siteMetadata from '@/data/siteMetadata'
import { formatDate } from '@/lib/formatDate'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { slug } from 'github-slugger'

export default function PostCard({
  post,
  locale,
  dateLocale,
  headingLevel = 'h2',
  priority = false,
}: {
  post: BlogListPost
  locale: Locale
  dateLocale: string
  headingLevel?: 'h1' | 'h2'
  priority?: boolean
}) {
  const primaryTag = post.tags?.[0]
  const postHref = `/${post.path}/`
  const Heading = headingLevel
  const labels = ui[locale]

  return (
    <article
      className={`${cardClass} overflow-hidden transition-colors duration-200 hover:ring-sky-300 dark:hover:ring-sky-700`}
      data-post-shell={post.path}
    >
      <Link
        href={postHref}
        aria-label={post.title}
        data-blog-post-link
        className="block overflow-hidden"
      >
        <div className="dark:bg-surface-cover-dark relative aspect-[2.65/1] bg-slate-100">
          <ResponsiveImage
            src={post.image || siteMetadata.socialBanner}
            alt=""
            fill
            sizes="(min-width: 1024px) 600px, 100vw"
            priority={priority}
            className="object-cover"
          />
        </div>
      </Link>
      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <Heading className="mb-3 text-[1.55rem] leading-tight font-medium text-slate-900 sm:text-[1.75rem] dark:text-white/90">
          <Link
            href={postHref}
            data-blog-post-link
            className="hover:text-sky-700 dark:hover:text-sky-300"
          >
            {post.title}
          </Link>
        </Heading>
        <ArticleGitMeta post={post} locale={locale} dateLocale={dateLocale} />
        {post.summary && (
          <Link
            href={postHref}
            data-blog-post-link
            className="mb-5 block text-base leading-8 text-slate-600 hover:text-sky-700 dark:text-white/75 dark:hover:text-sky-300"
          >
            {post.summary}
          </Link>
        )}

        <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 text-sm ${mutedText}`}>
          <MetaItem icon="calendar">
            <time dateTime={post.date} suppressHydrationWarning>
              {formatDate(post.date, dateLocale)}
            </time>
          </MetaItem>
          {primaryTag && (
            <MetaItem icon="tag">
              <Link
                href={localizePath(`/tags/${slug(primaryTag)}`, locale)}
                className="hover:text-sky-700 dark:hover:text-sky-300"
              >
                {primaryTag}
              </Link>
            </MetaItem>
          )}
          <Link
            href={postHref}
            data-blog-post-link
            className={`ml-auto inline-flex items-center gap-1.5 ${skyLink}`}
            aria-label={labels.readMoreLabel(post.title)}
          >
            <span>{labels.readMore}</span>
            <Icon name="ArrowRight" className="h-4 w-4" inlineSpacing={false} decorative />
          </Link>
        </div>
      </div>
    </article>
  )
}
