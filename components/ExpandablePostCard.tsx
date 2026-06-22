'use client'

import Image from '@/components/Image'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import { components as mdxComponents } from '@/components/MDXComponents'
import siteMetadata from '@/data/siteMetadata'
import type { BlogListPost } from '@/lib/listPosts'
import { localizePath, type Locale } from '@/lib/i18n'
import { slug } from 'github-slugger'
import MDXRenderer from '@/components/MDXRenderer'
import { formatDate, formatDateTime } from '@/lib/formatDate'
import { notifyBlogPathChange, setPendingBlogNavigationMotion } from '@/lib/blogRouteState'
import { getPreloadedPostBody, preloadPostBody } from '@/lib/postBodyPreload'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

const BODY_MOTION_DURATION = 560

const cardClass =
  'rounded-[8px] bg-white shadow-[0_14px_36px_rgba(21,30,43,0.07)] ' +
  'dark:bg-[#252d38] dark:shadow-none'
const skyLink = 'text-sky-500 transition hover:text-sky-400'
const mutedText = 'text-slate-500 dark:text-white/60'
const divider = 'border-slate-200 dark:border-[#405064]'
const iconClass = 'h-4 w-4 shrink-0 opacity-70'

const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
]

const GIT_LABELS = {
  zh: {
    updated: '更新于',
    commits: '相关提交',
    source: '查看源文',
    more: (count: number) => `另有 ${count} 次提交`,
  },
  en: {
    updated: 'Updated',
    commits: 'Related commits',
    source: 'View source',
    more: (count: number) => `+${count} more`,
  },
} as const

type IconName = 'calendar' | 'chevronDown' | 'chevronUp' | 'clock' | 'code' | 'gitCommit' | 'tag'

const META_ICON_NAMES: Record<IconName, string> = {
  calendar: 'Calendar',
  chevronDown: 'ChevronDown',
  chevronUp: 'ChevronUp',
  clock: 'Clock',
  code: 'Code',
  gitCommit: 'GitCommit',
  tag: 'Tag',
}

type PostGitCommit = {
  hash?: string
  shortHash?: string
  committedAt?: string
  subject?: string
  url?: string
}

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

function getPostGitCommits(commits: BlogListPost['gitCommits']) {
  return Array.isArray(commits)
    ? (commits as PostGitCommit[]).filter((commit) => commit.hash || commit.shortHash)
    : []
}

function formatRelativeTime(date: string | undefined, now: Date, locale: Locale) {
  if (!date) return ''

  const targetDate = new Date(date)

  if (Number.isNaN(targetDate.getTime())) {
    return ''
  }

  const diffMs = targetDate.getTime() - now.getTime()
  const absDiffMs = Math.abs(diffMs)
  const unit =
    RELATIVE_TIME_UNITS.find((candidate) => absDiffMs >= candidate.ms) ||
    RELATIVE_TIME_UNITS[RELATIVE_TIME_UNITS.length - 1]
  const value = Math.round(diffMs / unit.ms)
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  })

  return formatter.format(value, unit.unit)
}

function MetaIcon({ name }: { name: IconName }) {
  return <Icon name={META_ICON_NAMES[name]} className={iconClass} inlineSpacing={false} />
}

function MetaItem({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <MetaIcon name={icon} />
      <span className="min-w-0">{children}</span>
    </span>
  )
}

function useNow(intervalMs = 60 * 1000) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)

    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}

function usePostBody(post: BlogListPost) {
  const mountedRef = useRef(false)
  const [preloadedBodyCode, setPreloadedBodyCode] = useState<string | null>(null)

  const prefetchPost = useCallback(() => {
    if (post.bodyCode) {
      return
    }

    void preloadPostBody(post.path).then((preloadedCode) => {
      if (mountedRef.current && preloadedCode) {
        setPreloadedBodyCode(preloadedCode)
      }
    })
  }, [post.bodyCode, post.path])

  useEffect(() => {
    mountedRef.current = true
    prefetchPost()

    return () => {
      mountedRef.current = false
    }
  }, [prefetchPost])

  return {
    bodyCode: post.bodyCode || preloadedBodyCode,
    preloadedBodyCode,
    prefetchPost,
    setPreloadedBodyCode,
  }
}

function ArticleGitMeta({
  post,
  locale,
  dateLocale,
  now,
}: {
  post: BlogListPost
  locale: Locale
  dateLocale: string
  now: Date
}) {
  const updatedAt = post.gitUpdatedAt || post.lastmod || post.date
  const relativeUpdatedAt = formatRelativeTime(updatedAt, now, locale)
  const commits = getPostGitCommits(post.gitCommits)
  const commitCount = typeof post.gitCommitCount === 'number' ? post.gitCommitCount : commits.length
  const hiddenCommitCount = Math.max(0, commitCount - commits.length)
  const labels = GIT_LABELS[locale === 'zh' ? 'zh' : 'en']

  if (!updatedAt && commits.length === 0 && !post.githubUrl) {
    return null
  }

  return (
    <div className={`mb-5 space-y-3 text-sm leading-6 ${mutedText}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {updatedAt && (
          <MetaItem icon="clock">
            {labels.updated}{' '}
            <time dateTime={updatedAt} suppressHydrationWarning>
              {formatDateTime(updatedAt, dateLocale)}
            </time>
            {relativeUpdatedAt && (
              <span suppressHydrationWarning className="whitespace-nowrap">
                {' '}
                ({relativeUpdatedAt})
              </span>
            )}
          </MetaItem>
        )}
        {post.githubUrl && (
          <Link href={post.githubUrl} className={`inline-flex items-center gap-1.5 ${skyLink}`}>
            <MetaIcon name="code" />
            <span>{labels.source}</span>
          </Link>
        )}
      </div>
      {commits.length > 0 && (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5">
            <MetaIcon name="gitCommit" />
            <span>{labels.commits}</span>
          </div>
          <div className="space-y-1.5">
            {commits.map((commit) => {
              const hash = commit.shortHash || commit.hash?.slice(0, 7)

              if (!hash) {
                return null
              }

              const hashNode = (
                <span className="inline-flex rounded-[6px] bg-slate-100 px-1.5 py-0.5 font-mono text-xs leading-5 text-sky-500 dark:bg-white/10 dark:text-sky-400">
                  {hash}
                </span>
              )
              const message = commit.subject || commit.hash || ''
              const content = (
                <>
                  {hashNode}
                  {message && (
                    <span className="min-w-0 flex-1 basis-full break-words text-slate-600 sm:basis-0 dark:text-white/70">
                      {message}
                    </span>
                  )}
                </>
              )
              const className =
                'flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[6px] py-0.5'

              return commit.url ? (
                <Link
                  key={commit.hash || hash}
                  href={commit.url}
                  title={message}
                  className={`${className} transition hover:text-sky-400`}
                >
                  {content}
                </Link>
              ) : (
                <div key={commit.hash || hash} title={message} className={className}>
                  {content}
                </div>
              )
            })}
            {hiddenCommitCount > 0 && <div>{labels.more(hiddenCommitCount)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function ArticleLicenseNotice({ locale }: { locale: Locale }) {
  const isZh = locale === 'zh'
  const licenseHref = isZh
    ? 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans'
    : 'https://creativecommons.org/licenses/by-nc-sa/4.0/'

  return (
    <div className={`not-prose mt-10 border-t ${divider} pt-4 text-sm leading-7 ${mutedText}`}>
      {isZh ? (
        <p>
          除另有说明，本文内容采用{' '}
          <Link href={licenseHref} className={skyLink}>
            CC BY-NC-SA 4.0
          </Link>{' '}
          协议许可。转载或改编请署名、非商业使用，并以相同方式共享。
        </p>
      ) : (
        <p>
          Unless noted otherwise, this post is licensed under{' '}
          <Link href={licenseHref} className={skyLink}>
            CC BY-NC-SA 4.0
          </Link>
          . Please attribute, use non-commercially, and share adaptations under the same terms.
        </p>
      )}
    </div>
  )
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
  const previousUrlRef = useRef<string | null>(null)
  const previousScrollYRef = useRef<number | null>(null)
  const previousCardTopRef = useRef<number | null>(null)
  const expansionFrameRef = useRef<number | null>(null)
  const [shouldKeepBodyMounted, setShouldKeepBodyMounted] = useState(expanded)
  const now = useNow()
  const { bodyCode, preloadedBodyCode, prefetchPost, setPreloadedBodyCode } = usePostBody(post)
  const primaryTag = post.tags?.[0]
  const postHref = `/${post.path}/`
  const Heading = expanded ? 'h1' : headingLevel
  const shouldPreMountBody = Boolean(preloadedBodyCode && !post.bodyCode)
  const renderBody = bodyCode && (expanded || shouldKeepBodyMounted || shouldPreMountBody)

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
        <ArticleGitMeta post={post} locale={locale} dateLocale={dateLocale} now={now} />
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
            aria-label={`${expanded ? '收起文章' : '继续阅读'}：${post.title}`}
          >
            <span>{expanded ? '收起文章' : '继续阅读'}</span>
            <MetaIcon name={expanded ? 'chevronUp' : 'chevronDown'} />
          </Link>
        </div>
      </div>
    </article>
  )
}
