import Link from '@/components/Link'
import { MenuList, MenuListItem } from '@/components/animata/MenuList'
import { MetaIcon, MetaItem } from '@/components/PostMeta'
import { mutedText, skyLink } from '@/components/ui/styles'
import { formatDateTime, formatRelativeTime } from '@/lib/formatDate'
import { ui, type Locale } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { getCommitHash, getPostGitCommits } from '@/lib/postGit'

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
          <MenuList className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-white/10">
            {commits.map((commit) => {
              const hash = getCommitHash(commit)

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
        </div>
      )}
    </div>
  )
}
