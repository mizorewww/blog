import { getLocalePosts, getPublishedSitemapPosts } from '@/lib/content/posts'
import { countTerms, type TermField } from '@/lib/content/terms'
import { defaultLocale, localeConfig, locales, type Locale } from '@/lib/i18n'
import { absoluteSiteUrl } from '@/lib/urls'

type Alternates = {
  languages: Record<string, string>
}

/**
 * Build hreflang alternates for a locale-scoped section route (home, categories
 * index, tags index). Links every locale plus x-default pointing at the
 * default locale. Shared by page metadata and the sitemap so HTML head and
 * sitemap stay in sync.
 */
export function localizedAlternates(siteUrl: string, route = ''): Alternates {
  const languages = Object.fromEntries(
    locales.map((locale) => [
      localeConfig[locale].htmlLang,
      absoluteSiteUrl(siteUrl, `${locale}${route ? `/${route}` : ''}`),
    ])
  )

  return {
    languages: {
      ...languages,
      'x-default': absoluteSiteUrl(siteUrl, `${defaultLocale}${route ? `/${route}` : ''}`),
    },
  }
}

/**
 * Build hreflang alternates for a term page (a specific category or tag). Only
 * locales that actually contain the term are linked, so hreflang never points
 * at a route that was not generated.
 */
export function localizedTermAlternates(
  siteUrl: string,
  field: TermField,
  slug: string
): Alternates {
  const route = field === 'categories' ? 'categories' : 'tags'
  const languages: Record<string, string> = {}

  for (const locale of locales) {
    const counts = countTerms(getLocalePosts(locale), field)

    if (counts[slug]) {
      languages[localeConfig[locale].htmlLang] = absoluteSiteUrl(
        siteUrl,
        `${locale}/${route}/${slug}`
      )
    }
  }

  const defaultUrl = languages[localeConfig[defaultLocale].htmlLang]

  return {
    languages: {
      ...languages,
      ...(defaultUrl ? { 'x-default': defaultUrl } : {}),
    },
  }
}

type TranslationMember = {
  locale: Locale
  path: string
}

const translationGroups = new Map<string, TranslationMember[]>()

function getTranslationGroups() {
  if (translationGroups.size > 0) {
    return translationGroups
  }

  for (const post of getPublishedSitemapPosts()) {
    const key = post.translationKey || post.slug
    const group = translationGroups.get(key) || []

    group.push({ locale: post.locale, path: post.path })
    translationGroups.set(key, group)
  }

  return translationGroups
}

/**
 * Build hreflang alternates for a blog post using its translationKey group, so
 * translations with different slugs are paired correctly. Mirrors the sitemap's
 * translationKey grouping so HTML head and sitemap hreflang agree.
 */
export function localizedPostAlternates(
  siteUrl: string,
  post: { translationKey?: string; slug: string; locale: string; path: string }
): Alternates {
  const key = post.translationKey || post.slug
  const members = getTranslationGroups().get(key) || [
    { locale: post.locale as Locale, path: post.path },
  ]
  const languages = Object.fromEntries(
    members.map((member) => [
      localeConfig[member.locale].htmlLang,
      absoluteSiteUrl(siteUrl, member.path),
    ])
  )
  const defaultUrl = languages[localeConfig[defaultLocale].htmlLang]

  return {
    languages: {
      ...languages,
      ...(defaultUrl ? { 'x-default': defaultUrl } : {}),
    },
  }
}
