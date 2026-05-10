import { ReactNode } from 'react'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog, Authors } from 'contentlayer/generated'
import Comments from '@/components/Comments'
import Link from '@/components/Link'
import PageTitle from '@/components/PageTitle'
import Image from '@/components/Image'
import Tag from '@/components/Tag'
import siteMetadata from '@/data/siteMetadata'
import ScrollTopAndComment from '@/components/ScrollTopAndComment'
import { getPostLocale } from '@/lib/blog'
import { localeConfig, localizePath, ui } from '@/lib/i18n'
import { slug as slugify } from 'github-slugger'

const editUrl = (path) => `${siteMetadata.siteRepo}/blob/main/data/${path}`
const discussUrl = (path) =>
  `https://x.com/search?q=${encodeURIComponent(`${siteMetadata.siteUrl}/${path}`)}`

const postDateTemplate: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}

interface LayoutProps {
  content: CoreContent<Blog>
  authorDetails: CoreContent<Authors>[]
  next?: { path: string; title: string }
  prev?: { path: string; title: string }
  children: ReactNode
}

export default function PostLayout({ content, authorDetails, next, prev, children }: LayoutProps) {
  const { filePath, path, slug, date, title, categories, tags } = content
  const locale = getPostLocale(content)
  const labels = ui[locale]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-10 pb-16 sm:px-6 lg:pt-20">
      <ScrollTopAndComment />
      <article className="rounded-[10px] bg-white px-5 py-8 shadow-[0_18px_45px_rgba(21,30,43,0.08)] sm:px-8 lg:px-10 dark:bg-[#252d38] dark:shadow-none">
        <header className="mx-auto max-w-3xl text-center">
          <time dateTime={date} className="text-base font-medium text-slate-500 dark:text-white/60">
            {new Date(date).toLocaleDateString(localeConfig[locale].dateLocale, postDateTemplate)}
          </time>
          <div className="mt-4 text-slate-900 dark:text-white/90">
            <PageTitle>{title}</PageTitle>
          </div>
        </header>

        <div className="mt-10 grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="space-y-8">
            <ul className="flex flex-wrap gap-4 lg:block lg:space-y-5">
              {authorDetails.map((author) => (
                <li className="flex items-center space-x-3" key={author.name}>
                  {author.avatar && (
                    <Image
                      src={author.avatar}
                      width={44}
                      height={44}
                      alt="avatar"
                      className="h-11 w-11 rounded-full"
                    />
                  )}
                  <dl className="text-sm leading-5 font-medium whitespace-nowrap">
                    <dt className="sr-only">Name</dt>
                    <dd className="text-slate-900 dark:text-white/90">{author.name}</dd>
                    <dt className="sr-only">X</dt>
                    <dd>
                      {author.x && (
                        <Link href={author.x} className="text-sky-500 hover:text-sky-400">
                          {author.x.replace('https://x.com/', '@')}
                        </Link>
                      )}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>

            {categories && categories.length > 0 && (
              <div>
                <h2 className="mb-3 text-xs tracking-wide text-slate-500 uppercase dark:text-white/60">
                  {labels.categories}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Link
                      key={category}
                      href={localizePath(`/categories/${slugify(category)}`, locale)}
                      className="rounded-[8px] bg-slate-100 px-3 py-1 text-sm text-slate-600 transition hover:bg-sky-500 hover:text-white dark:bg-[#405064] dark:text-white/75 dark:hover:bg-sky-500"
                    >
                      {category}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {tags && tags.length > 0 && (
              <div>
                <h2 className="mb-3 text-xs tracking-wide text-slate-500 uppercase dark:text-white/60">
                  {labels.tags}
                </h2>
                <div className="flex flex-wrap">
                  {tags.map((tag) => (
                    <Tag key={tag} text={tag} locale={locale} />
                  ))}
                </div>
              </div>
            )}

            <Link href={`/${locale}/blog`} className="block text-sky-500 hover:text-sky-400">
              &larr; {labels.backToBlog}
            </Link>
          </aside>

          <div className="min-w-0">
            <div className="prose prose-slate dark:prose-invert max-w-none pt-0 pb-8">
              {children}
            </div>
            <div className="border-t border-slate-200 pt-6 pb-6 text-sm text-slate-600 dark:border-[#405064] dark:text-white/70">
              <Link href={discussUrl(path)} rel="nofollow" className="text-sky-500">
                {labels.discussOnX}
              </Link>
              {` • `}
              <Link href={editUrl(filePath)} className="text-sky-500">
                {labels.viewOnGithub}
              </Link>
            </div>
            {(next || prev) && (
              <nav className="grid gap-4 border-t border-slate-200 py-6 text-sm sm:grid-cols-2 dark:border-[#405064]">
                {prev && prev.path && (
                  <div>
                    <h2 className="text-xs tracking-wide text-slate-500 uppercase dark:text-white/60">
                      {labels.previousArticle}
                    </h2>
                    <Link href={`/${prev.path}`} className="text-sky-500 hover:text-sky-400">
                      {prev.title}
                    </Link>
                  </div>
                )}
                {next && next.path && (
                  <div>
                    <h2 className="text-xs tracking-wide text-slate-500 uppercase dark:text-white/60">
                      {labels.nextArticle}
                    </h2>
                    <Link href={`/${next.path}`} className="text-sky-500 hover:text-sky-400">
                      {next.title}
                    </Link>
                  </div>
                )}
              </nav>
            )}
            {siteMetadata.comments && (
              <div className="pt-6 pb-6 text-center text-slate-700 dark:text-white/70" id="comment">
                <Comments slug={slug} />
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}
