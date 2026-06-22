import { MetadataRoute } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { getPublishedSitemapPosts } from '@/lib/content/posts'
import { defaultLocale, localeConfig, locales, type Locale } from '@/lib/i18n'
import { getPostModifiedDate, latestDate } from '@/lib/postDates'
import { absoluteSiteUrl } from '@/lib/urls'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = siteMetadata.siteUrl
  const publishedPosts = getPublishedSitemapPosts()
  const latestPostDate =
    latestDate(publishedPosts.map((post) => getPostModifiedDate(post))) || new Date(0).toISOString()
  const latestByLocale = locales.reduce(
    (latest, locale) => {
      latest[locale] =
        latestDate(
          publishedPosts
            .filter((post) => post.locale === locale)
            .map((post) => getPostModifiedDate(post))
        ) || latestPostDate
      return latest
    },
    {} as Record<Locale, string>
  )
  const postsByTranslationKey = publishedPosts.reduce((groups, post) => {
    const key = post.translationKey || post.slug
    const group = groups.get(key) || []
    group.push(post)
    groups.set(key, group)
    return groups
  }, new Map<string, typeof publishedPosts>())

  const localizedAlternates = (route = '') => {
    const languages = Object.fromEntries(
      locales.map((locale) => [
        localeConfig[locale].htmlLang,
        absoluteSiteUrl(siteUrl, `${locale}${route ? `/${route}` : ''}`),
      ])
    )

    return {
      languages: {
        ...languages,
        'x-default':
          route === ''
            ? absoluteSiteUrl(siteUrl)
            : absoluteSiteUrl(siteUrl, `${defaultLocale}/${route}`),
      },
    }
  }

  const postAlternates = (post: (typeof publishedPosts)[number]) => {
    const translations = postsByTranslationKey.get(post.translationKey || post.slug) || [post]
    const languages = Object.fromEntries(
      translations.map((translation) => [
        localeConfig[translation.locale].htmlLang,
        absoluteSiteUrl(siteUrl, translation.path),
      ])
    )

    return {
      languages: {
        ...languages,
        ...(languages[localeConfig[defaultLocale].htmlLang]
          ? { 'x-default': languages[localeConfig[defaultLocale].htmlLang] }
          : {}),
      },
    }
  }

  const blogRoutes = publishedPosts.map((post) => ({
    url: absoluteSiteUrl(siteUrl, post.path),
    lastModified: getPostModifiedDate(post),
    alternates: postAlternates(post),
  }))

  const routes = [
    {
      route: '',
      lastModified: latestByLocale[defaultLocale],
      alternates: localizedAlternates(),
    },
    ...locales.flatMap((locale) => [
      {
        route: locale,
        lastModified: latestByLocale[locale],
        alternates: localizedAlternates(),
      },
    ]),
  ].map(({ route, lastModified, alternates }) => ({
    url: absoluteSiteUrl(siteUrl, route),
    lastModified,
    alternates,
  }))

  return [...routes, ...blogRoutes]
}
