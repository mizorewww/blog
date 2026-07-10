import type { Authors, Blog } from 'contentlayer/generated'
import type { CoreContent } from '@/lib/contentlayer'
import ArticleGitMeta from '@/components/ArticleGitMeta'
import ArticleLicenseNotice from '@/components/ArticleLicenseNotice'
import ArticleReader from '@/components/ArticleReader'
import ArticleReturnLink from '@/components/ArticleReturnLink'
import ArticleTableOfContents from '@/components/ArticleTableOfContents'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import MDXServerRenderer from '@/components/MDXServerRenderer'
import { MetaItem } from '@/components/PostMeta'
import PostNavLinks from '@/components/PostNavLinks'
import ResponsiveImage from '@/components/ResponsiveImage'
import { mutedText, skyLink } from '@/components/ui/styles'
import siteMetadata from '@/data/siteMetadata'
import { formatDate } from '@/lib/formatDate'
import { localizePath, localeConfig, type Locale, ui } from '@/lib/i18n'
import { toListPost, type PostNavItem } from '@/lib/listPosts'
import type { TocHeading } from '@/lib/toc'
import { slug } from 'github-slugger'

export default function PostLayout({
  post,
  authorDetails,
  previousPost,
  nextPost,
  toc,
  locale,
}: {
  post: Blog
  authorDetails: CoreContent<Authors>[]
  previousPost: PostNavItem | null
  nextPost: PostNavItem | null
  toc: TocHeading[]
  locale: Locale
}) {
  const labels = ui[locale]
  const dateLocale = localeConfig[locale].dateLocale
  const homeHref = localizePath('/', locale)
  const authorNames = authorDetails.map((author) => author.name).filter(Boolean)
  const postMeta = toListPost(post)

  return (
    <div className="article-shell mx-auto w-full px-4 pt-4 pb-16 sm:px-5 sm:pt-6 lg:px-0">
      <ArticleReader>
        <header className="article-header min-w-0">
          <ArticleReturnLink
            key={post.path}
            href={homeHref}
            ariaLabel={labels.backToList}
            className={`mb-6 inline-flex items-center gap-2 text-sm font-medium ${skyLink}`}
          >
            <Icon name="ArrowLeft" className="h-4 w-4" inlineSpacing={false} decorative />
            <span>{labels.backToArticles}</span>
          </ArticleReturnLink>
          <h1 className="text-3xl leading-tight font-semibold text-slate-950 sm:text-4xl dark:text-white/95">
            {post.title}
          </h1>
          {post.summary && (
            <p className="mt-4 text-lg leading-8 text-slate-600 dark:text-white/70">
              {post.summary}
            </p>
          )}
          <div className={`mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${mutedText}`}>
            {authorNames.length > 0 && <span>{authorNames.join(', ')}</span>}
            <MetaItem icon="calendar">
              <span>{labels.publishedOn} </span>
              <time dateTime={post.date}>{formatDate(post.date, dateLocale)}</time>
            </MetaItem>
            {post.tags.slice(0, 3).map((tag) => (
              <Link
                key={tag}
                href={localizePath(`/tags/${slug(tag)}`, locale)}
                className="hover:text-sky-700 dark:hover:text-sky-300"
              >
                #{tag}
              </Link>
            ))}
          </div>
          <div className="mt-5">
            <ArticleGitMeta post={postMeta} locale={locale} dateLocale={dateLocale} showCommits />
          </div>
          <div className="dark:bg-surface-cover-dark relative mt-7 aspect-[16/9] overflow-hidden rounded-[8px] bg-slate-100">
            <ResponsiveImage
              src={post.image || siteMetadata.socialBanner}
              alt=""
              fill
              sizes="(min-width: 1280px) 780px, 100vw"
              priority
              className="object-cover"
            />
          </div>
        </header>

        <ArticleTableOfContents headings={toc} locale={locale} />

        <div className="article-body min-w-0" data-article-body>
          <div className="prose prose-slate dark:prose-invert max-w-none">
            <MDXServerRenderer modulePath={post.mdxModulePath} />
            <ArticleLicenseNotice locale={locale} />
          </div>
        </div>

        <PostNavLinks previousPost={previousPost} nextPost={nextPost} locale={locale} />
      </ArticleReader>
    </div>
  )
}
