import siteMetadata from '@/data/siteMetadata'
import { getBlogListData } from '@/lib/content/posts'
import {
  formatTermTitle,
  getSortedTermSummaries,
  termSlug,
  type TermField,
} from '@/lib/content/terms'
import { localizePath, type Locale, ui } from '@/lib/i18n'
import { createTermCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl, decodeRouteParam } from '@/lib/urls'

type TermIndexConfig = {
  description: (locale: Locale) => string
  route: string
  title: (locale: Locale) => string
}

const termIndexConfig: Record<TermField, TermIndexConfig> = {
  categories: {
    description: (locale) => ui[locale].categoriesIndexDescription,
    route: '/categories',
    title: (locale) => ui[locale].allCategories,
  },
  tags: {
    description: (locale) => ui[locale].tagsIndexDescription,
    route: '/tags',
    title: (locale) => ui[locale].allTags,
  },
}

export function getTermIndexConfig(field: TermField) {
  return termIndexConfig[field]
}

export function buildTermIndexPageData(locale: Locale, field: TermField) {
  const { categoryCounts, tagCounts } = getBlogListData(locale)
  const counts = field === 'categories' ? categoryCounts : tagCounts
  const terms = getSortedTermSummaries(counts)
  const config = getTermIndexConfig(field)
  const title = config.title(locale)

  return {
    title,
    description: config.description(locale),
    route: config.route,
    counts,
    terms,
    jsonLd: createTermCollectionJsonLd({
      title,
      description: config.description(locale),
      url: absoluteSiteUrl(siteMetadata.siteUrl, localizePath(config.route, locale)),
      locale,
      items: terms.map((term) => ({
        name: term.label,
        url: absoluteSiteUrl(
          siteMetadata.siteUrl,
          localizePath(`${config.route}/${term.slug}`, locale)
        ),
        description: `${term.count} articles`,
      })),
    }),
  }
}

export function buildTermPageMeta(locale: Locale, field: TermField, rawTerm: string) {
  const requestedTerm = decodeRouteParam(rawTerm)
  const slug = termSlug(requestedTerm)
  const { categoryCounts, tagCounts } = getBlogListData(locale)
  const counts = field === 'categories' ? categoryCounts : tagCounts
  const term = counts[slug]?.label || requestedTerm
  const title = formatTermTitle(term)
  const config = getTermIndexConfig(field)
  const path = `${config.route}/${slug}`
  const description =
    field === 'categories'
      ? ui[locale].categoryPageDescription(term)
      : ui[locale].tagPageDescription(term)

  return {
    term,
    slug,
    title,
    path,
    description,
    url: absoluteSiteUrl(siteMetadata.siteUrl, localizePath(path, locale)),
  }
}
