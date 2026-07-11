import type { Authors, Blog } from 'contentlayer/generated'
import type { CoreContent } from '@/lib/contentlayer'
import ArticleCardPresentation from '@/components/ArticleCardPresentation'
import ArticleGitMeta from '@/components/ArticleGitMeta'
import ArticleLicenseNotice from '@/components/ArticleLicenseNotice'
import ArticleReader from '@/components/ArticleReader'
import ArticleReturnLink from '@/components/ArticleReturnLink'
import ArticleTableOfContents from '@/components/ArticleTableOfContents'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import MDXServerRenderer from '@/components/MDXServerRenderer'
import PostNavLinks from '@/components/PostNavLinks'
import ResponsiveImage from '@/components/ResponsiveImage'
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
    <div className="article-shell mx-auto w-full pb-16 sm:pt-6">
      <ArticleReader>
        <div
          className="article-reading-surface dark:bg-surface-card-dark relative z-0 min-w-0 overflow-hidden bg-white shadow-sm ring-1 shadow-slate-300/70 ring-slate-950/5 dark:shadow-black/20 dark:ring-white/10"
          data-article-surface
        >
          <header className="article-header min-w-0">
            <div
              className="dark:bg-surface-cover-dark relative aspect-[16/9] overflow-hidden bg-slate-100"
              data-article-cover
            >
              <ResponsiveImage
                src={post.image || siteMetadata.socialBanner}
                alt=""
                fill
                sizes="(min-width: 640px) 780px, 100vw"
                priority
                className="object-cover"
              />
              <ArticleReturnLink
                key={post.path}
                href={homeHref}
                ariaLabel={labels.backToList}
                className="absolute top-3 right-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm ring-1 ring-slate-950/10 backdrop-blur transition-colors duration-180 hover:bg-white hover:text-sky-700 dark:bg-slate-950/80 dark:text-white/90 dark:ring-white/15 dark:hover:bg-slate-950 dark:hover:text-sky-300"
              >
                <Icon name="X" className="h-5 w-5" inlineSpacing={false} decorative />
              </ArticleReturnLink>
            </div>

            <ArticleCardPresentation
              headingLevel="h1"
              title={post.title}
              gitMeta={<ArticleGitMeta post={postMeta} locale={locale} dateLocale={dateLocale} />}
              summary={post.summary}
              publishedAt={post.date}
              publishedText={formatDate(post.date, dateLocale)}
              primaryTag={post.tags[0]}
              primaryTagHref={
                post.tags[0] ? localizePath(`/tags/${slug(post.tags[0])}`, locale) : undefined
              }
            />

            {(authorNames.length > 0 || post.tags.length > 1 || post.gitCommits.length > 0) && (
              <div className="px-5 pb-8 text-sm text-slate-500 sm:px-6 dark:text-white/60">
                {(authorNames.length > 0 || post.tags.length > 1) && (
                  <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {authorNames.length > 0 && <span>{authorNames.join(', ')}</span>}
                    {post.tags.slice(1, 3).map((tag) => (
                      <Link
                        key={tag}
                        href={localizePath(`/tags/${slug(tag)}`, locale)}
                        className="hover:text-sky-700 dark:hover:text-sky-300"
                      >
                        #{tag}
                      </Link>
                    ))}
                  </div>
                )}
                <ArticleGitMeta
                  post={postMeta}
                  locale={locale}
                  dateLocale={dateLocale}
                  showCommits
                  showOverview={false}
                />
              </div>
            )}
          </header>

          <ArticleTableOfContents headings={toc} locale={locale} variant="mobile" />

          <div className="px-5 pt-10 pb-10 sm:px-8 lg:px-10">
            <div className="article-body min-w-0" data-article-body>
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <MDXServerRenderer modulePath={post.mdxModulePath} />
                <ArticleLicenseNotice locale={locale} />
              </div>
            </div>

            {(previousPost || nextPost) && (
              <div className="mt-10">
                <PostNavLinks previousPost={previousPost} nextPost={nextPost} locale={locale} />
              </div>
            )}
          </div>
        </div>

        <ArticleTableOfContents headings={toc} locale={locale} variant="desktop" />
      </ArticleReader>
    </div>
  )
}
