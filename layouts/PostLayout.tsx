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
import { divider, imageOutlineClass, mutedText, skyLink } from '@/components/ui/styles'
import siteMetadata from '@/data/siteMetadata'
import {
  ARTICLE_DESKTOP_TOC_BREAKPOINT,
  ARTICLE_SHELL_MAX_WIDTH,
  ARTICLE_TOC_GAP,
  ARTICLE_TOC_WIDTH,
} from '@/lib/articleLayout'
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
  const secondaryTags = post.tags.slice(1)
  const hasArticleDetails =
    authorNames.length > 0 || secondaryTags.length > 0 || post.gitCommits.length > 0
  const coverSizes = `(min-width: ${ARTICLE_DESKTOP_TOC_BREAKPOINT}px) calc(min(100vw - 30px, ${ARTICLE_SHELL_MAX_WIDTH}px) - ${ARTICLE_TOC_WIDTH + ARTICLE_TOC_GAP}px), (min-width: 640px) min(100vw - 30px, ${ARTICLE_SHELL_MAX_WIDTH}px), 100vw`

  return (
    <div className="article-shell mx-auto w-full pb-16 sm:pt-6">
      <ArticleReader>
        <div
          className="article-reading-surface dark:bg-surface-card-dark relative z-0 min-w-0 overflow-hidden bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.04),0_14px_40px_rgba(15,23,42,0.08)] ring-1 ring-slate-950/5 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)] dark:ring-white/10"
          data-article-surface
        >
          <header className="article-header min-w-0">
            <div
              className="dark:bg-surface-cover-dark relative aspect-[2/1] overflow-hidden bg-slate-100 sm:aspect-[2.8/1]"
              data-article-cover
            >
              <ResponsiveImage
                src={post.image || siteMetadata.socialBanner}
                alt=""
                fill
                sizes={coverSizes}
                priority
                className={`${imageOutlineClass} object-cover`}
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
              gitMeta={
                <ArticleGitMeta
                  post={postMeta}
                  locale={locale}
                  dateLocale={dateLocale}
                  variant="article"
                />
              }
              summary={post.summary}
              publishedAt={post.date}
              publishedText={formatDate(post.date, dateLocale)}
              primaryTag={post.tags[0]}
              primaryTagHref={
                post.tags[0] ? localizePath(`/tags/${slug(post.tags[0])}`, locale) : undefined
              }
              variant="article"
            />
          </header>

          <ArticleTableOfContents headings={toc} locale={locale} variant="mobile" />

          <div
            className={
              hasArticleDetails || previousPost || nextPost
                ? 'article-prose prose prose-slate dark:prose-invert max-w-none min-w-0 pt-6'
                : 'article-prose prose prose-slate dark:prose-invert max-w-none min-w-0 pt-6 pb-10'
            }
            data-article-body
          >
            <MDXServerRenderer modulePath={post.mdxModulePath} />
            <ArticleLicenseNotice locale={locale} />
          </div>

          {hasArticleDetails && (
            <section
              data-article-transition-destination-only
              className={
                previousPost || nextPost
                  ? `article-content-rail article-data-block not-prose mt-8 border-t ${divider} pt-5 text-sm leading-7 ${mutedText}`
                  : `article-content-rail article-data-block not-prose mt-8 border-t ${divider} pt-5 pb-10 text-sm leading-7 ${mutedText}`
              }
            >
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[6px] px-1 text-slate-700 transition-colors duration-150 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white/80 dark:hover:text-sky-300 [&::-webkit-details-marker]:hidden">
                  <span className="font-medium">{labels.articleDetails}</span>
                  <Icon
                    name="ChevronDown"
                    className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none dark:text-white/60"
                    inlineSpacing={false}
                    decorative
                  />
                </summary>
                <div className="mt-3 space-y-4">
                  {(authorNames.length > 0 || secondaryTags.length > 0) && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {authorNames.length > 0 && (
                        <span>
                          {labels.articleAuthors}: {authorNames.join(', ')}
                        </span>
                      )}
                      {secondaryTags.map((tag) => (
                        <Link
                          key={tag}
                          href={localizePath(`/tags/${slug(tag)}`, locale)}
                          className={skyLink}
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
                    variant="article"
                  />
                </div>
              </details>
            </section>
          )}

          {(previousPost || nextPost) && (
            <div className="article-content-rail mt-10 pb-10">
              <PostNavLinks previousPost={previousPost} nextPost={nextPost} locale={locale} />
            </div>
          )}
        </div>

        <ArticleTableOfContents headings={toc} locale={locale} variant="desktop" />
      </ArticleReader>
    </div>
  )
}
