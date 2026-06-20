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
import { notifyBlogPathChange, setPendingBlogNavigationMotion } from '@/lib/blogRouteState'
import { getPreloadedPostBody, preloadPostBody } from '@/lib/postBodyPreload'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'

const cardClass =
  'rounded-[8px] bg-white shadow-[0_14px_36px_rgba(21,30,43,0.07)] dark:bg-[#252d38] dark:shadow-none'
const BODY_MOTION_DURATION = 560

type ExpandedChangeContext = {
  previousCardTop: number | null
  previousScrollY: number | null
  previousUrl: string | null
}

type ExpandedChangeOptions = {
  afterMotion?: () => void
}

function getHistoryState() {
  return typeof window.history.state === 'object' && window.history.state !== null
    ? window.history.state
    : {}
}

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
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
    context: ExpandedChangeContext,
    options?: ExpandedChangeOptions
  ) => void
  headingLevel?: 'h1' | 'h2'
}) {
  const router = useRouter()
  const mountedRef = useRef(false)
  const previousUrlRef = useRef<string | null>(null)
  const previousScrollYRef = useRef<number | null>(null)
  const previousCardTopRef = useRef<number | null>(null)
  const expansionFrameRef = useRef<number | null>(null)
  const [shouldKeepBodyMounted, setShouldKeepBodyMounted] = useState(expanded)
  const [preloadedBodyCode, setPreloadedBodyCode] = useState<string | null>(null)
  const primaryTag = post.tags?.[0]
  const postHref = `/${post.path}/`
  const Heading = expanded ? 'h1' : headingLevel
  const bodyCode = post.bodyCode || preloadedBodyCode
  const shouldPreMountBody = Boolean(preloadedBodyCode && !post.bodyCode)
  const renderBody = bodyCode && (expanded || shouldKeepBodyMounted || shouldPreMountBody)
  const prefetchPost = useCallback(() => {
    if (!post.bodyCode) {
      void preloadPostBody(post.path).then((preloadedCode) => {
        if (mountedRef.current && preloadedCode) {
          setPreloadedBodyCode(preloadedCode)
        }
      })
    }
  }, [post.bodyCode, post.path])

  useEffect(() => {
    mountedRef.current = true
    prefetchPost()

    return () => {
      mountedRef.current = false

      if (expansionFrameRef.current !== null) {
        window.cancelAnimationFrame(expansionFrameRef.current)
      }
    }
  }, [prefetchPost])

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
      const previousUrl = previousUrlRef.current || localizePath('/', locale)
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

    const availableBodyCode = bodyCode || getPreloadedPostBody(post.path)

    const shouldPrimeBodyBeforeExpansion = Boolean(
      availableBodyCode && !preloadedBodyCode && !post.bodyCode
    )

    if (availableBodyCode && shouldPrimeBodyBeforeExpansion) {
      setPreloadedBodyCode(availableBodyCode)
    }

    if (availableBodyCode && window.location.pathname !== postHref) {
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

    const expansionContext = {
      previousCardTop: previousCardTopRef.current,
      previousScrollY: previousScrollYRef.current,
      previousUrl: previousUrlRef.current,
    }

    if (!availableBodyCode) {
      setPendingBlogNavigationMotion(post.path, postHref, expansionContext)
      prefetchPost()
      router.push(postHref)
      return
    }

    if (shouldPrimeBodyBeforeExpansion) {
      expansionFrameRef.current = window.requestAnimationFrame(() => {
        expansionFrameRef.current = null
        onExpandedChange(true, expansionContext)
      })
      return
    }

    onExpandedChange(true, expansionContext)
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

        {bodyCode && (
          <div
            data-post-body-motion={post.path}
            aria-hidden={!expanded}
            className={`grid transition-all duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-0 ${
              expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="border-t border-slate-200 pt-5 pb-1 dark:border-[#405064]">
                {renderBody && (
                  <div className="prose prose-slate dark:prose-invert max-w-none">
                    <MDXRenderer code={bodyCode} components={mdxComponents} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
          <Link
            href={postHref}
            onClick={onReadMore}
            onMouseEnter={prefetchPost}
            onFocus={prefetchPost}
            className="ml-auto inline-flex items-center gap-2 text-sky-500 transition hover:text-sky-400"
            aria-expanded={expanded}
            aria-label={`${expanded ? '收起文章' : '继续阅读'}：${post.title}`}
          >
            {expanded ? '收起文章' : '继续阅读'}
          </Link>
        </div>
      </div>
    </article>
  )
}
