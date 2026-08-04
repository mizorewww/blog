import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import { MetaItem } from '@/components/PostMeta'
import { mutedText, skyLink } from '@/components/ui/styles'

export type ArticleCardPresentationVariant = 'card' | 'article'

export const articleCardPresentationClasses = {
  content: 'px-4 py-4 sm:px-6 sm:py-6',
  title:
    'mb-2.5 text-[1.35rem] leading-[1.18] font-medium text-slate-900 sm:mb-3 sm:text-[1.65rem] sm:leading-tight dark:text-white/90',
  git: `mb-3 space-y-2 text-[0.8125rem] leading-5 sm:mb-4 sm:text-sm sm:leading-6 ${mutedText}`,
  gitRow: 'flex flex-wrap items-start gap-x-3 gap-y-1.5 sm:gap-x-4 sm:gap-y-2',
  summary:
    'mb-4 block line-clamp-2 text-[0.95rem] leading-6 text-slate-600 sm:mb-5 sm:text-base sm:leading-7 dark:text-white/75',
  footer: `flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.8125rem] sm:gap-x-4 sm:gap-y-3 sm:text-sm ${mutedText}`,
  footerMeta: 'flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4 sm:gap-y-3',
  readMoreSlot: 'ml-auto inline-flex items-center',
  readMore: `inline-flex items-center gap-1.5 ${skyLink}`,
} as const

const articlePresentationClasses = {
  ...articleCardPresentationClasses,
  content: 'article-content-rail pt-5 pb-4 sm:pt-6 sm:pb-5',
  title:
    'mb-3 text-[1.8rem] leading-[1.14] font-semibold text-slate-950 sm:text-[2.15rem] sm:leading-[1.12] dark:text-white/95',
  git: `mb-4 space-y-2 text-[0.8125rem] leading-6 ${mutedText}`,
  summary: 'mb-4 block text-base leading-7 text-slate-600 dark:text-white/75',
  footer: `flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${mutedText}`,
} as const

export function getArticleCardPresentationClasses(
  variant: ArticleCardPresentationVariant = 'card'
) {
  return variant === 'article' ? articlePresentationClasses : articleCardPresentationClasses
}

type ReadMorePresentation = {
  href: string
  label: string
  ariaLabel: string
}

export default function ArticleCardPresentation({
  headingLevel: Heading,
  title,
  titleHref,
  gitMeta,
  summary,
  summaryHref,
  publishedAt,
  publishedText,
  primaryTag,
  primaryTagHref,
  readMore,
  variant = 'card',
}: {
  headingLevel: 'h1' | 'h2'
  title: string
  titleHref?: string
  gitMeta: ReactNode
  summary?: string
  summaryHref?: string
  publishedAt: string
  publishedText: string
  primaryTag?: string
  primaryTagHref?: string
  readMore?: ReadMorePresentation
  variant?: ArticleCardPresentationVariant
}) {
  const classes = getArticleCardPresentationClasses(variant)

  return (
    <div className={classes.content} data-article-card-presentation>
      <Heading className={classes.title} data-article-transition-title>
        {titleHref ? (
          <Link
            href={titleHref}
            data-blog-post-link
            className="hover:text-sky-700 dark:hover:text-sky-300"
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </Heading>

      {gitMeta}

      {summary &&
        (summaryHref ? (
          <Link
            href={summaryHref}
            data-blog-post-link
            data-article-transition-summary
            className={`${classes.summary} hover:text-sky-700 dark:hover:text-sky-300`}
          >
            {summary}
          </Link>
        ) : (
          <p data-article-transition-summary className={classes.summary}>
            {summary}
          </p>
        ))}

      <div className={classes.footer}>
        <div className={classes.footerMeta}>
          <MetaItem icon="calendar" data-article-transition-date>
            <time dateTime={publishedAt} suppressHydrationWarning>
              {publishedText}
            </time>
          </MetaItem>
          {primaryTag && (
            <MetaItem icon="tag" data-article-transition-primary-tag>
              {primaryTagHref ? (
                <Link href={primaryTagHref} className="hover:text-sky-700 dark:hover:text-sky-300">
                  {primaryTag}
                </Link>
              ) : (
                primaryTag
              )}
            </MetaItem>
          )}
        </div>

        {readMore && (
          <div className={classes.readMoreSlot} data-article-transition-read-more>
            <Link
              href={readMore.href}
              data-blog-post-link
              className={classes.readMore}
              aria-label={readMore.ariaLabel}
            >
              <span>{readMore.label}</span>
              <Icon name="ArrowRight" className="h-4 w-4" inlineSpacing={false} decorative />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
