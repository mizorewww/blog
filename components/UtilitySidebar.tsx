import { MenuList, MenuListItem } from '@/components/animata/MenuList'
import BlogWidgetCard from '@/components/BlogWidgetCard'
import Link from '@/components/Link'
import { formatDate, formatDateTime } from '@/lib/formatDate'
import { type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { getCommitHash, getLatestPostGitCommit } from '@/lib/postGit'

export default function UtilitySidebar({
  posts,
  dateLocale,
  locale,
}: {
  posts: BlogListPost[]
  dateLocale: string
  locale: Locale
}) {
  const labels = ui[locale]

  return (
    <aside className="blog-sidebar-right space-y-5 bg-transparent lg:self-start">
      <BlogWidgetCard title={labels.recentPosts}>
        <MenuList className="dark:divide-border-muted-dark divide-y divide-slate-200">
          {posts.slice(0, 4).map((post) => {
            const latestCommit = getLatestPostGitCommit(post)
            const latestCommitHash = latestCommit ? getCommitHash(latestCommit) : ''

            return (
              <MenuListItem key={post.path} className="py-4 first:pt-0">
                <Link href={`/${post.path}/`} className="block">
                  <time
                    dateTime={post.date}
                    suppressHydrationWarning
                    className="block text-sm text-slate-500 dark:text-white/60"
                  >
                    {formatDate(post.date, dateLocale)}
                  </time>
                  <span className="mt-2 block text-base leading-7 text-slate-800 hover:text-sky-500 dark:text-white/80">
                    {post.title}
                  </span>
                </Link>
                {latestCommit && latestCommitHash && (
                  <div className="mt-2 border-l border-slate-200 pl-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:text-white/55">
                    <Link
                      href={latestCommit.url || `/${post.path}/`}
                      className="inline-flex max-w-full flex-col hover:text-sky-500"
                      aria-label={labels.latestCommit(latestCommitHash)}
                    >
                      <span className="font-mono text-sky-500 dark:text-sky-400">
                        {latestCommitHash}
                      </span>
                      {latestCommit.subject && (
                        <span className="break-words">{latestCommit.subject}</span>
                      )}
                      {latestCommit.committedAt && (
                        <time dateTime={latestCommit.committedAt} suppressHydrationWarning>
                          {formatDateTime(latestCommit.committedAt, dateLocale)}
                        </time>
                      )}
                    </Link>
                  </div>
                )}
              </MenuListItem>
            )
          })}
        </MenuList>
      </BlogWidgetCard>
    </aside>
  )
}
