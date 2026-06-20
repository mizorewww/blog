import { MetadataRoute } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { getPublishedSitemapPosts } from '@/lib/content/posts'
import { termSlug, type TermField } from '@/lib/content/terms'
import { absoluteSiteUrl } from '@/lib/urls'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = siteMetadata.siteUrl
  const publishedPosts = getPublishedSitemapPosts()

  const blogRoutes = publishedPosts.map((post) => ({
    url: absoluteSiteUrl(siteUrl, post.path),
    lastModified: post.lastmod || post.date,
  }))

  const termRoutes = (field: TermField, routeSegment: string) => {
    const latestByRoute = new Map<string, string>()

    publishedPosts.forEach((post) => {
      post[field]?.forEach((term) => {
        const route = `${post.locale}/${routeSegment}/${termSlug(term)}`
        const lastModified = post.lastmod || post.date
        const currentLastModified = latestByRoute.get(route)

        if (!currentLastModified || new Date(lastModified) > new Date(currentLastModified)) {
          latestByRoute.set(route, lastModified)
        }
      })
    })

    return Array.from(latestByRoute.entries()).map(([route, lastModified]) => ({
      url: absoluteSiteUrl(siteUrl, route),
      lastModified,
    }))
  }

  const categoryRoutes = termRoutes('categories', 'categories')
  const tagRoutes = termRoutes('tags', 'tags')

  const routes = ['', 'zh', 'en', 'zh/categories', 'en/categories', 'zh/tags', 'en/tags'].map(
    (route) => ({
      url: absoluteSiteUrl(siteUrl, route),
      lastModified: new Date().toISOString().split('T')[0],
    })
  )

  return [...routes, ...categoryRoutes, ...tagRoutes, ...blogRoutes]
}
