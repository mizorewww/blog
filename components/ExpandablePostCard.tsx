'use client'

import ArticleGitMeta from '@/components/ArticleGitMeta'
import ArticleLicenseNotice from '@/components/ArticleLicenseNotice'
import Image from '@/components/Image'
import Link from '@/components/Link'
import { MetaIcon, MetaItem } from '@/components/PostMeta'
import { cardClass, mutedText, skyLink } from '@/components/ui/styles'
import siteMetadata from '@/data/siteMetadata'
import { useNow } from '@/lib/hooks/useNow'
import type { BlogListPost } from '@/lib/listPosts'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import { slug } from 'github-slugger'
import { formatDate } from '@/lib/formatDate'
import {
  clearBlogListReturnContext,
  getStoredBlogListReturnContext,
  notifyBlogPathChange,
  setBlogListReturnContext,
  setPendingBlogNavigationMotion,
} from '@/lib/blogRouteState'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

const BODY_MOTION_DURATION = 560

type ExpandedChangeContext = {
  previousCardTop: number | null
  previousScrollY: number | null
  previousUrl: string | null
}

type ExpandedChangeOptions = {
  afterMotion?: () => void
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export default function ExpandablePostCard({
  post,
  locale,
  dateLocale,
  expanded,
  body,
  onExpandedChange,
  headingLevel = 'h2',
}: {
  post: BlogListPost
  locale: Locale
  dateLocale: string
  expanded: boolean
  body?: ReactNode
  onExpandedChange: (
    expanded: boolean,
    context: ExpandedChangeContext,
    options?: ExpandedChangeOptions
  ) => void
  headingLevel?: 'h1' | 'h2'
}) {
  const router = useRouter()
  const previousUrlRef = useRef<string | null>(null)
  const previousScrollYRef = useRef<number | null>(null)
  const previousCardTopRef = useRef<number | null>(null)
  const expansionFrameRef = useRef<number | null>(null)
  const [shouldKeepBodyMounted, setShouldKeepBodyMounted] = useState(expanded)
  const now = useNow()
  const primaryTag = post.tags?.[0]
  const postHref = `/${post.path}/`
  const Heading = expanded ? 'h1' : headingLevel
  const labels = ui[locale]
  const renderBody = body && (expanded || shouldKeepBodyMounted)

  useEffect(() => {
    return () => {
      if (expansionFrameRef.current !== null) {
        window.cancelAnimationFrame(expansionFrameRef.current)
      }
    }
  }, [])

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

  const onReadMore = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainPrimaryClick(event)) {
      return
    }

    event.preventDefault()

    if (expansionFrameRef.current !== null) {
      window.cancelAnimationFrame(expansionFrameRef.current)
      expansionFrameRef.current = null
    }

    if (expanded) {
      const storedContext = getStoredBlogListReturnContext(post.path)
      const previousUrl =
        previousUrlRef.current || storedContext?.previousUrl || localizePath('/', locale)
      const previousScrollY = previousScrollYRef.current ?? storedContext?.previousScrollY ?? null
      const previousCardTop = previousCardTopRef.current ?? storedContext?.previousCardTop ?? null

      window.history.pushState(null, '', previousUrl)
      notifyBlogPathChange()
      previousUrlRef.current = null
      previousScrollYRef.current = null
      previousCardTopRef.current = null
      clearBlogListReturnContext(post.path)
      onExpandedChange(false, { previousCardTop, previousScrollY, previousUrl })
      return
    }

    previousUrlRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    previousScrollYRef.current = window.scrollY
    previousCardTopRef.current =
      event.currentTarget.closest('article')?.getBoundingClientRect().top ?? null

    const expansionContext = {
      previousCardTop: previousCardTopRef.current,
      previousScrollY: previousScrollYRef.current,
      previousUrl: previousUrlRef.current,
    }

    setBlogListReturnContext(post.path, expansionContext)
    setPendingBlogNavigationMotion(post.path, postHref, expansionContext)
    router.prefetch(postHref)
    router.push(postHref, { scroll: false })
  }

  return (
    <article className={`${cardClass} overflow-hidden`} data-post-path={post.path}>
      <Link href={postHref} aria-label={post.title} className="block overflow-hidden">
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
          <Link href={postHref} className="transition hover:text-sky-500">
            {post.title}
          </Link>
        </Heading>
        <ArticleGitMeta post={post} locale={locale} dateLocale={dateLocale} now={now} />
        {post.summary && (
          <p className="mb-5 text-base leading-8 text-slate-600 dark:text-white/75">
            {post.summary}
          </p>
        )}

        {body && (
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
            onMouseEnter={() => router.prefetch(postHref)}
            onFocus={() => router.prefetch(postHref)}
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
