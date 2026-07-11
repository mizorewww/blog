import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import { MetaItem } from '@/components/PostMeta'
import { mutedText, skyLink } from '@/components/ui/styles'

export const articleCardPresentationClasses = {
  content: 'px-5 py-5 sm:px-6 sm:py-6',
  title:
    'mb-3 text-[1.55rem] leading-tight font-medium text-slate-900 sm:text-[1.75rem] dark:text-white/90',
  git: `mb-5 space-y-3 text-sm leading-6 ${mutedText}`,
  gitRow: 'flex flex-wrap items-start gap-x-4 gap-y-2',
  summary: 'mb-5 block text-base leading-8 text-slate-600 dark:text-white/75',
  footer: `flex flex-wrap items-center gap-x-4 gap-y-3 text-sm ${mutedText}`,
  footerMeta: 'flex flex-wrap items-center gap-x-4 gap-y-3',
  readMoreSlot: 'ml-auto inline-flex items-center',
  readMore: `inline-flex items-center gap-1.5 ${skyLink}`,
} as const

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
}) {
  return (
    <div className={articleCardPresentationClasses.content} data-article-card-presentation>
      <Heading className={articleCardPresentationClasses.title} data-article-transition-title>
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
            className={`${articleCardPresentationClasses.summary} hover:text-sky-700 dark:hover:text-sky-300`}
          >
            {summary}
          </Link>
        ) : (
          <p data-article-transition-summary className={articleCardPresentationClasses.summary}>
            {summary}
          </p>
        ))}

      <div className={articleCardPresentationClasses.footer}>
        <div className={articleCardPresentationClasses.footerMeta}>
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
          <div
            className={articleCardPresentationClasses.readMoreSlot}
            data-article-transition-read-more
          >
            <Link
              href={readMore.href}
              data-blog-post-link
              className={articleCardPresentationClasses.readMore}
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
