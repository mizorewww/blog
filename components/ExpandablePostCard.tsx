'use client'

import Image from '@/components/Image'
import Link from '@/components/Link'
import { components as mdxComponents } from '@/components/MDXComponents'
import siteMetadata from '@/data/siteMetadata'
import type { BlogListPost } from '@/lib/listPosts'
import { localizePath, type Locale } from '@/lib/i18n'
import { slug } from 'github-slugger'
import MDXRenderer from '@/components/MDXRenderer'
import { formatDate } from '@/lib/formatDate'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'

const cardClass =
  'rounded-[8px] bg-white shadow-[0_14px_36px_rgba(21,30,43,0.07)] dark:bg-[#252d38] dark:shadow-none'
const BODY_MOTION_DURATION = 560
const BLOG_PATH_CHANGE_EVENT = 'blog-pathchange'

function getHistoryState() {
  return typeof window.history.state === 'object' && window.history.state !== null
    ? window.history.state
    : {}
}

function notifyBlogPathChange() {
  window.dispatchEvent(new Event(BLOG_PATH_CHANGE_EVENT))
}

export default function ExpandablePostCard({
  post,
  locale,
  dateLocale,
  expanded,
  onExpandedChange,
  headingLevel = 'h2',
}: {
  post: BlogListPost
  locale: Locale
  dateLocale: string
  expanded: boolean
  onExpandedChange: (
    expanded: boolean,
    context: {
      previousCardTop: number | null
      previousScrollY: number | null
      previousUrl: string | null
    }
  ) => void
  headingLevel?: 'h1' | 'h2'
}) {
  const previousUrlRef = useRef<string | null>(null)
  const previousScrollYRef = useRef<number | null>(null)
  const previousCardTopRef = useRef<number | null>(null)
  const [shouldKeepBodyMounted, setShouldKeepBodyMounted] = useState(expanded)
  const primaryTag = post.tags?.[0]
  const postHref = `/${post.path}`
  const Heading = expanded ? 'h1' : headingLevel
  const renderBody = (expanded || shouldKeepBodyMounted) && post.bodyCode

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
    event.preventDefault()

    if (expanded) {
      const previousUrl = previousUrlRef.current || localizePath('/blog', locale)
      const previousScrollY = previousScrollYRef.current

      window.history.pushState(null, '', previousUrl)
      notifyBlogPathChange()
      previousUrlRef.current = null
      previousScrollYRef.current = null
      const previousCardTop = previousCardTopRef.current
      previousCardTopRef.current = null
      onExpandedChange(false, { previousCardTop, previousScrollY, previousUrl })
      return
    }

    previousUrlRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    previousScrollYRef.current = window.scrollY
    previousCardTopRef.current =
      event.currentTarget.closest('article')?.getBoundingClientRect().top ?? null

    const historyState = getHistoryState()

    window.history.replaceState(
      {
        ...historyState,
        blogListReturn: {
          postPath: post.path,
          previousCardTop: previousCardTopRef.current,
          previousScrollY: previousScrollYRef.current,
        },
      },
      '',
      previousUrlRef.current
    )

    if (window.location.pathname !== postHref) {
      window.history.pushState(
        {
          ...historyState,
          blogExpandedPath: post.path,
          blogPreviousUrl: previousUrlRef.current,
        },
        '',
        postHref
      )
      notifyBlogPathChange()
    }

    onExpandedChange(true, {
      previousCardTop: previousCardTopRef.current,
      previousScrollY: previousScrollYRef.current,
      previousUrl: previousUrlRef.current,
    })
  }

  return (
    <article className={`${cardClass} overflow-hidden`} data-post-path={post.path}>
      <Link href={postHref} aria-label={post.title} className="block overflow-hidden">
        <div className="relative aspect-[2.65/1] bg-slate-100 dark:bg-[#111827]">
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
        {post.summary && (
          <p className="mb-5 text-base leading-8 text-slate-600 dark:text-white/75">
            {post.summary}
          </p>
        )}

        <div
          className={`grid transition-all duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0 ${
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <div className="border-t border-slate-200 pt-5 pb-1 dark:border-[#405064]">
              {renderBody && (
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <MDXRenderer code={post.bodyCode || ''} components={mdxComponents} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 text-sm text-slate-500 dark:text-white/60">
          <time dateTime={post.date} suppressHydrationWarning>
            {formatDate(post.date, dateLocale)}
          </time>
          {primaryTag && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={localizePath(`/tags/${slug(primaryTag)}`, locale)}
                className="transition hover:text-sky-500"
              >
                {primaryTag}
              </Link>
            </>
          )}
          <a
            href={postHref}
            onClick={onReadMore}
            className="ml-auto inline-flex items-center gap-2 text-sky-500 transition hover:text-sky-400"
            aria-expanded={expanded}
            aria-label={`${expanded ? '收起文章' : '继续阅读'}：${post.title}`}
          >
            {expanded ? '收起文章' : '继续阅读'}
          </a>
        </div>
      </div>
    </article>
  )
}
