import { MetadataRoute } from 'next'
import siteMetadata from '@/data/siteMetadata'
import {
  getLocalePosts,
  getLocalizedCategoryParams,
  getLocalizedTagParams,
  getPostBySlug,
  getPublishedSitemapPosts,
} from '@/lib/content/posts'
import { getPostsByTerm, type TermField } from '@/lib/content/terms'
import { locales, type Locale } from '@/lib/i18n'
import { getPostModifiedDate, latestDate } from '@/lib/postDates'
import {
  localizedAlternates,
  localizedPostAlternates,
  localizedTermAlternates,
} from '@/lib/seo/alternates'
import { absoluteSiteUrl } from '@/lib/urls'

export const dynamic = 'force-static'

function latestPostModifiedDate(
  posts: { date: string; gitUpdatedAt?: string; lastmod?: string }[]
) {
  return latestDate(posts.map((post) => getPostModifiedDate(post)))
}

function buildTermEntry(siteUrl: string, route: string, locale: Locale, slug: string) {
  const posts = getPostsByTerm(
    getLocalePosts(locale),
    route === 'categories' ? 'categories' : 'tags',
    slug
  )

  return {
    url: absoluteSiteUrl(siteUrl, `${locale}/${route}/${slug}`),
    lastModified: latestPostModifiedDate(posts) || new Date(0).toISOString(),
    alternates: localizedTermAlternates(
      siteUrl,
      route === 'categories' ? 'categories' : 'tags',
      slug
    ),
  }
}

function localizedTermEntries(siteUrl: string, field: TermField) {
  const route = field === 'categories' ? 'categories' : 'tags'

  if (field === 'categories') {
    return getLocalizedCategoryParams().map((entry) =>
      buildTermEntry(siteUrl, route, entry.locale, entry.category)
    )
  }

  return getLocalizedTagParams().map((entry) =>
    buildTermEntry(siteUrl, route, entry.locale, entry.tag)
  )
}

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = siteMetadata.siteUrl
  const publishedPosts = getPublishedSitemapPosts()
  const latestPostDate =
    latestDate(publishedPosts.map((post) => getPostModifiedDate(post))) || new Date(0).toISOString()
  const latestByLocale = locales.reduce<Record<Locale, string>>(
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

  const localeSectionRoutes = locales.flatMap((locale) => [
    {
      url: absoluteSiteUrl(siteUrl, locale),
      lastModified: latestByLocale[locale],
      alternates: localizedAlternates(siteUrl),
    },
    {
      url: absoluteSiteUrl(siteUrl, `${locale}/categories`),
      lastModified: latestByLocale[locale],
      alternates: localizedAlternates(siteUrl, 'categories'),
    },
    {
      url: absoluteSiteUrl(siteUrl, `${locale}/tags`),
      lastModified: latestByLocale[locale],
      alternates: localizedAlternates(siteUrl, 'tags'),
    },
  ])

  const termRoutes = [
    ...localizedTermEntries(siteUrl, 'categories'),
    ...localizedTermEntries(siteUrl, 'tags'),
  ]

  const blogRoutes = publishedPosts.map((post) => {
    const fullPost = getPostBySlug(post.locale, post.slug)
    const images = fullPost?.image
      ? [{ url: absoluteSiteUrl(siteUrl, fullPost.image) }]
      : fullPost?.images && Array.isArray(fullPost.images)
        ? (fullPost.images as string[]).map((image) => ({ url: absoluteSiteUrl(siteUrl, image) }))
        : []

    return {
      url: absoluteSiteUrl(siteUrl, post.path),
      lastModified: getPostModifiedDate(post),
      alternates: localizedPostAlternates(siteUrl, post),
      ...(images.length > 0 ? { images } : {}),
    }
  })

  return [...localeSectionRoutes, ...termRoutes, ...blogRoutes]
}
