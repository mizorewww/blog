import siteMetadata from '@/data/siteMetadata'
import { getBlogListData } from '@/lib/content/posts'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl } from '@/lib/urls'

export function buildHomePageData(locale: Locale, canonicalPath = localizePath('/', locale)) {
  const { posts } = getBlogListData(locale)

  return {
    posts,
    title: ui[locale].home,
    jsonLd: createPostCollectionJsonLd({
      title: ui[locale].latest,
      description: siteMetadata.description,
      url: absoluteSiteUrl(siteMetadata.siteUrl, canonicalPath),
      locale,
      posts,
    }),
  }
}
