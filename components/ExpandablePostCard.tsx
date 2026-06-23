'use client'

import ArticleGitMeta from '@/components/ArticleGitMeta'
import ArticleLicenseNotice from '@/components/ArticleLicenseNotice'
import Image from '@/components/Image'
import Link from '@/components/Link'
import { MetaIcon, MetaItem } from '@/components/PostMeta'
import { cardClass, mutedText, skyLink } from '@/components/ui/styles'
import siteMetadata from '@/data/siteMetadata'
import { useExpandablePostNavigation } from '@/lib/hooks/useExpandablePostNavigation'
import { useNow } from '@/lib/hooks/useNow'
import type { BlogListPost } from '@/lib/listPosts'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import { slug } from 'github-slugger'
import { formatDate } from '@/lib/formatDate'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

const BODY_MOTION_DURATION = 560

export default function ExpandablePostCard({
  post,
  locale,
  dateLocale,
  expanded,
  body,
  headingLevel = 'h2',
}: {
  post: BlogListPost
  locale: Locale
  dateLocale: string
  expanded: boolean
  body?: ReactNode
  headingLevel?: 'h1' | 'h2'
}) {
  const [shouldKeepBodyMounted, setShouldKeepBodyMounted] = useState(expanded)
  const now = useNow()
  const primaryTag = post.tags?.[0]
  const postHref = `/${post.path}/`
  const Heading = expanded ? 'h1' : headingLevel
  const labels = ui[locale]
  const hasBody = Boolean(body)
  const renderBody = hasBody && (expanded || shouldKeepBodyMounted)
  const { articleRef, onOpenPost, onReadMore, prefetchPost } = useExpandablePostNavigation({
    expanded,
    locale,
    postHref,
    postPath: post.path,
  })

  useEffect(() => {
    if (expanded) {
      setShouldKeepBodyMounted(true)
      return
    }

    if (!shouldKeepBodyMounted) {
      return
    }

    const timer = window.setTimeout(() => {
      setShouldKeepBodyMounted(false)
    }, BODY_MOTION_DURATION)

    return () => window.clearTimeout(timer)
  }, [expanded, shouldKeepBodyMounted])

  return (
    <article ref={articleRef} className={`${cardClass} overflow-hidden`} data-post-path={post.path}>
      <Link
        href={postHref}
        aria-label={post.title}
        onClick={expanded ? undefined : onOpenPost}
        onMouseEnter={prefetchPost}
        onFocus={prefetchPost}
        className="block overflow-hidden"
      >
        <div className="dark:bg-surface-cover-dark relative aspect-[2.65/1] bg-slate-100">
          <Image
            src={post.image || siteMetadata.socialBanner}
            alt=""
            fill
            sizes="(min-width: 1024px) 600px, 100vw"
            className="object-cover transition duration-500 hover:scale-[1.02]"
          />
        </div>
      </Link>
      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <Heading className="mb-3 text-[1.55rem] leading-tight font-medium text-slate-900 sm:text-[1.75rem] dark:text-white/90">
          <Link
            href={postHref}
            onClick={expanded ? undefined : onOpenPost}
            onMouseEnter={prefetchPost}
            onFocus={prefetchPost}
            className="transition hover:text-sky-500"
          >
            {post.title}
          </Link>
        </Heading>
        <ArticleGitMeta post={post} locale={locale} dateLocale={dateLocale} now={now} />
        {post.summary && (
          <p className="mb-5 text-base leading-8 text-slate-600 dark:text-white/75">
            {post.summary}
          </p>
        )}

        {hasBody && (
          <div
            data-post-body-motion={post.path}
            aria-hidden={!expanded}
            className={`grid transition-all duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0 ${
              expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="dark:border-border-subtle-dark border-t border-slate-200 pt-5 pb-1">
                {renderBody && (
                  <div className="prose prose-slate dark:prose-invert max-w-none">
                    {body}
                    <ArticleLicenseNotice locale={locale} />
                  </div>
                )}
              </div>
            </div>
          </div>
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
                className="transition hover:text-sky-500"
              >
                {primaryTag}
              </Link>
            </MetaItem>
          )}
          <Link
            href={postHref}
            onClick={onReadMore}
            onMouseEnter={prefetchPost}
            onFocus={prefetchPost}
            className={`ml-auto inline-flex items-center gap-1.5 ${skyLink}`}
            aria-expanded={expanded}
            aria-label={
              expanded ? labels.collapseLabel(post.title) : labels.readMoreLabel(post.title)
            }
          >
            <span>{expanded ? labels.collapse : labels.readMore}</span>
            <MetaIcon name={expanded ? 'chevronUp' : 'chevronDown'} />
          </Link>
        </div>
      </div>
    </article>
  )
}
