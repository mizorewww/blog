import siteMetadata from '@/data/siteMetadata'
import { getBlogListData } from '@/lib/content/posts'
import { formatTermTitle, termSlug, type CountMap, type TermField } from '@/lib/content/terms'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import { createTermCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl, decodeRouteParam } from '@/lib/urls'

type TermIndexConfig = {
  description: string
  route: string
  title: (locale: Locale) => string
}

const termIndexConfig: Record<TermField, TermIndexConfig> = {
  categories: {
    description: 'Article categories',
    route: '/categories',
    title: (locale) => ui[locale].allCategories,
  },
  tags: {
    description: 'Things I blog about',
    route: '/tags',
    title: (locale) => ui[locale].allTags,
  },
}

function sortTerms(counts: CountMap) {
  return Object.keys(counts).sort((first, second) => counts[second] - counts[first])
}

export function getTermIndexConfig(field: TermField) {
  return termIndexConfig[field]
}

export function buildTermIndexPageData(locale: Locale, field: TermField) {
  const { categoryCounts, tagCounts } = getBlogListData(locale)
  const counts = field === 'categories' ? categoryCounts : tagCounts
  const sortedTerms = sortTerms(counts)
  const config = getTermIndexConfig(field)
  const title = config.title(locale)

  return {
    title,
    description: config.description,
    route: config.route,
    counts,
    sortedTerms,
    jsonLd: createTermCollectionJsonLd({
      title,
      description: config.description,
      url: absoluteSiteUrl(siteMetadata.siteUrl, localizePath(config.route, locale)),
      locale,
      items: sortedTerms.map((term) => ({
        name: term,
        url: absoluteSiteUrl(siteMetadata.siteUrl, localizePath(`${config.route}/${term}`, locale)),
        description: `${counts[term]} articles`,
      })),
    }),
  }
}

export function buildTermPageMeta(locale: Locale, field: TermField, rawTerm: string) {
  const term = decodeRouteParam(rawTerm)
  const slug = termSlug(term)
  const title = formatTermTitle(term)
  const config = getTermIndexConfig(field)
  const path = `${config.route}/${slug}`
  const description = `${siteMetadata.title} ${term} ${field === 'categories' ? 'category' : 'tagged'} content`

  return {
    term,
    slug,
    title,
    path,
    description,
    url: absoluteSiteUrl(siteMetadata.siteUrl, localizePath(path, locale)),
  }
}
