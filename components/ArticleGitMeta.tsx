'use client'

import { useId, useState } from 'react'
import {
  getArticleCardPresentationClasses,
  type ArticleCardPresentationVariant,
} from '@/components/ArticleCardPresentation'
import CollapsiblePanel from '@/components/animata/CollapsiblePanel'
import Link from '@/components/Link'
import { MenuList, MenuListItem } from '@/components/animata/MenuList'
import { MetaIcon, MetaItem } from '@/components/PostMeta'
import { skyLink } from '@/components/ui/styles'
import { formatDateTime, formatRelativeTime } from '@/lib/formatDate'
import { useNow } from '@/lib/hooks/useNow'
import { ui, type Locale } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { getCommitHash, getPostGitCommits } from '@/lib/postGit'

export default function ArticleGitMeta({
  post,
  locale,
  dateLocale,
  showCommits = false,
  showOverview = true,
  variant = 'card',
}: {
  post: BlogListPost
  locale: Locale
  dateLocale: string
  showCommits?: boolean
  showOverview?: boolean
  variant?: ArticleCardPresentationVariant
}) {
  const now = useNow()
  const [commitsOpen, setCommitsOpen] = useState(false)
  const commitsPanelId = useId()
  const updatedAt = post.gitUpdatedAt || post.lastmod || post.date
  const relativeUpdatedAt = formatRelativeTime(updatedAt, now, locale)
  const commits = getPostGitCommits(post.gitCommits)
  const latestCommit = commits[0]
  const latestCommitHash = latestCommit ? getCommitHash(latestCommit) : ''
  const commitCount = typeof post.gitCommitCount === 'number' ? post.gitCommitCount : commits.length
  const hiddenCommitCount = Math.max(0, commitCount - commits.length)
  const labels = ui[locale]

  const hasOverview = Boolean(updatedAt || post.githubUrl)
  const hasCommits = showCommits && commits.length > 0
  const classes = getArticleCardPresentationClasses(variant)

  if ((!showOverview || !hasOverview) && !hasCommits) {
    return null
  }

  return (
    <div className={classes.git}>
      {showOverview && hasOverview && (
        <div className={classes.gitRow}>
          {updatedAt && (
            <MetaItem icon="clock" data-article-transition-git-updated>
              {labels.gitUpdated}{' '}
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
            <Link
              href={post.githubUrl}
              data-article-transition-git-source
              className={`inline-flex items-center gap-1.5 ${skyLink}`}
            >
              <MetaIcon name="code" />
              <span>{labels.gitSource}</span>
            </Link>
          )}
        </div>
      )}
      {hasCommits && (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={commitsOpen}
            aria-controls={commitsPanelId}
            onClick={() => setCommitsOpen((open) => !open)}
            className="inline-flex min-w-0 flex-wrap items-center gap-1.5 text-left hover:text-sky-700 dark:hover:text-sky-300"
          >
            <MetaIcon name="gitCommit" />
            <span>{labels.gitCommits}</span>
            {latestCommitHash && (
              <span className="inline-flex rounded-[6px] bg-slate-100 px-1.5 py-0.5 font-mono text-xs leading-5 text-sky-700 dark:bg-white/10 dark:text-sky-400">
                {latestCommitHash}
              </span>
            )}
            <MetaIcon name={commitsOpen ? 'chevronUp' : 'chevronDown'} />
          </button>
          <CollapsiblePanel
            id={commitsPanelId}
            open={commitsOpen}
            contentClassName="border-l border-slate-200 pl-3 dark:border-white/10"
          >
            <MenuList className="space-y-1.5">
              {commits.map((commit) => {
                const hash = getCommitHash(commit)

                if (!hash) {
                  return null
                }

                const hashNode = (
                  <span className="inline-flex rounded-[6px] bg-slate-100 px-1.5 py-0.5 font-mono text-xs leading-5 text-sky-700 dark:bg-white/10 dark:text-sky-400">
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
                  <MenuListItem key={commit.hash || hash}>
                    <Link
                      href={commit.url}
                      title={message}
                      className={`${className} hover:text-sky-400`}
                    >
                      {content}
                    </Link>
                  </MenuListItem>
                ) : (
                  <MenuListItem key={commit.hash || hash}>
                    <div title={message} className={className}>
                      {content}
                    </div>
                  </MenuListItem>
                )
              })}
              {hiddenCommitCount > 0 && <div>{labels.gitMore(hiddenCommitCount)}</div>}
            </MenuList>
          </CollapsiblePanel>
        </div>
      )}
    </div>
  )
}
