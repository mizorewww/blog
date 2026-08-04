import ArticleGitMeta from '@/components/ArticleGitMeta'
import ArticleCardPresentation from '@/components/ArticleCardPresentation'
import Link from '@/components/Link'
import ResponsiveImage from '@/components/ResponsiveImage'
import { cardClass, imageOutlineClass, interactiveSurfaceClass } from '@/components/ui/styles'
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
      className={`${cardClass} ${interactiveSurfaceClass} overflow-hidden hover:ring-sky-300 dark:hover:ring-sky-700`}
      data-post-shell={post.path}
      data-article-transition-card
      data-article-transition-key={post.path}
    >
      <Link
        href={postHref}
        aria-label={post.title}
        data-blog-post-link
        className="block overflow-hidden"
      >
        <div
          className="dark:bg-surface-cover-dark relative aspect-[3.15/1] bg-slate-100 sm:aspect-[2.75/1]"
          data-article-transition-cover
        >
          <ResponsiveImage
            src={post.image || siteMetadata.socialBanner}
            alt=""
            fill
            sizes="(min-width: 1024px) 600px, 100vw"
            priority={priority}
            className={`${imageOutlineClass} object-cover`}
          />
        </div>
      </Link>
      <ArticleCardPresentation
        headingLevel={Heading}
        title={post.title}
        titleHref={postHref}
        gitMeta={<ArticleGitMeta post={post} locale={locale} dateLocale={dateLocale} />}
        summary={post.summary}
        summaryHref={post.summary ? postHref : undefined}
        publishedAt={post.date}
        publishedText={formatDate(post.date, dateLocale)}
        primaryTag={primaryTag}
        primaryTagHref={primaryTag ? localizePath(`/tags/${slug(primaryTag)}`, locale) : undefined}
        readMore={{
          href: postHref,
          label: labels.readMore,
          ariaLabel: labels.readMoreLabel(post.title),
        }}
      />
    </article>
  )
}
