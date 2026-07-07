'use client'

import CollapsiblePanel from '@/components/animata/CollapsiblePanel'
import HoverScale from '@/components/animata/HoverScale'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'
import ArticleGitMeta from '@/components/ArticleGitMeta'
import ArticleLicenseNotice from '@/components/ArticleLicenseNotice'
import PostNavLinks from '@/components/PostNavLinks'
import ReadingProgress from '@/components/ReadingProgress'
import ResponsiveImage from '@/components/ResponsiveImage'
import TableOfContents from '@/components/TableOfContents'
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
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

export default function ExpandablePostCard({
  post,
  locale,
  dateLocale,
  expanded,
  body,
  allPosts,
  headingLevel = 'h2',
  priority = false,
  onSaveScroll,
}: {
  post: BlogListPost
  locale: Locale
  dateLocale: string
  expanded: boolean
  body?: ReactNode
  allPosts?: BlogListPost[]
  headingLevel?: 'h1' | 'h2'
  priority?: boolean
  onSaveScroll?: () => void
}) {
  const now = useNow()
  const primaryTag = post.tags?.[0]
  const postHref = `/${post.path}/`
  const Heading = expanded ? 'h1' : headingLevel
  const labels = ui[locale]
  const hasBody = Boolean(body)
  const shouldReduceMotion = useReducedMotion()
  const { articleRef, onOpenPost, onReadMore, prefetchPost } = useExpandablePostNavigation({
    expanded,
    locale,
    postHref,
    onSaveScroll: onSaveScroll ?? (() => {}),
  })

  return (
    <article
      ref={articleRef}
      className={`${cardClass} overflow-hidden ${!expanded ? 'transition-colors duration-200 hover:ring-sky-300 dark:hover:ring-sky-700' : ''}`}
      data-post-path={post.path}
    >
      <Link
        href={postHref}
        aria-label={post.title}
        onClick={expanded ? undefined : onOpenPost}
        onMouseEnter={prefetchPost}
        onFocus={prefetchPost}
        className="block overflow-hidden"
      >
        <div className="dark:bg-surface-cover-dark relative aspect-[2.65/1] bg-slate-100">
          <HoverScale className="absolute inset-0">
            <ResponsiveImage
              src={post.image || siteMetadata.socialBanner}
              alt=""
              fill
              sizes="(min-width: 1024px) 600px, 100vw"
              priority={priority}
              className="object-cover"
            />
          </HoverScale>
        </div>
      </Link>
      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <Heading className="mb-3 text-[1.55rem] leading-tight font-medium text-slate-900 sm:text-[1.75rem] dark:text-white/90">
          <Link
            href={postHref}
            onClick={expanded ? undefined : onOpenPost}
            onMouseEnter={prefetchPost}
            onFocus={prefetchPost}
            className="hover:text-sky-700 dark:hover:text-sky-300"
          >
            {post.title}
          </Link>
        </Heading>
        <ArticleGitMeta
          post={post}
          locale={locale}
          dateLocale={dateLocale}
          now={now}
          showCommits={expanded}
        />
        {post.summary && (
          <Link
            href={postHref}
            onClick={expanded ? undefined : onOpenPost}
            onMouseEnter={prefetchPost}
            onFocus={prefetchPost}
            className="mb-5 block text-base leading-8 text-slate-600 hover:text-sky-700 dark:text-white/75 dark:hover:text-sky-300"
          >
            {post.summary}
          </Link>
        )}

        {expanded && <ReadingProgress targetRef={articleRef} />}
        {hasBody && (
          <CollapsiblePanel
            id={post.path}
            open={expanded}
            contentClassName="dark:border-border-subtle-dark border-t border-slate-200 pt-5 pb-1"
          >
            {expanded && (
              <>
                <TableOfContents containerRef={articleRef} locale={locale} />
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  {body}
                  <ArticleLicenseNotice locale={locale} />
                </div>
                {allPosts && allPosts.length > 1 && (
                  <PostNavLinks
                    currentPost={post}
                    allPosts={allPosts}
                    locale={locale}
                    dateLocale={dateLocale}
                  />
                )}
              </>
            )}
          </CollapsiblePanel>
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
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: animataQuickDuration, ease: animataEase }
              }
              className="inline-flex"
            >
              <MetaIcon name="chevronDown" />
            </motion.span>
          </Link>
        </div>
      </div>
    </article>
  )
}
