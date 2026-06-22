import Link from '@/components/Link'
import { MetaIcon, MetaItem } from '@/components/PostMeta'
import { mutedText, skyLink } from '@/components/ui/styles'
import { formatDateTime, formatRelativeTime } from '@/lib/formatDate'
import { ui, type Locale } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'

type PostGitCommit = {
  hash?: string
  shortHash?: string
  committedAt?: string
  subject?: string
  url?: string
}

function getPostGitCommits(commits: BlogListPost['gitCommits']) {
  return Array.isArray(commits)
    ? (commits as PostGitCommit[]).filter((commit) => commit.hash || commit.shortHash)
    : []
}

export default function ArticleGitMeta({
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
  const labels = ui[locale]

  if (!updatedAt && commits.length === 0 && !post.githubUrl) {
    return null
  }

  return (
    <div className={`mb-5 space-y-3 text-sm leading-6 ${mutedText}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {updatedAt && (
          <MetaItem icon="clock">
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
          <Link href={post.githubUrl} className={`inline-flex items-center gap-1.5 ${skyLink}`}>
            <MetaIcon name="code" />
            <span>{labels.gitSource}</span>
          </Link>
        )}
      </div>
      {commits.length > 0 && (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5">
            <MetaIcon name="gitCommit" />
            <span>{labels.gitCommits}</span>
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
            {hiddenCommitCount > 0 && <div>{labels.gitMore(hiddenCommitCount)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
