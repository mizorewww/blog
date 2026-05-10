import { MetadataRoute } from 'next'
import { allBlogs } from 'contentlayer/generated'
import siteMetadata from '@/data/siteMetadata'
import { getPostLocale } from '@/lib/blog'
import { slug } from 'github-slugger'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = siteMetadata.siteUrl
  const publishedPosts = allBlogs.filter((post) => !post.draft)

  const blogRoutes = publishedPosts.map((post) => ({
    url: `${siteUrl}/${post.path}`,
    lastModified: post.lastmod || post.date,
  }))

  const termRoutes = (field: 'categories' | 'tags', routeSegment: string) => {
    const latestByRoute = new Map<string, string>()

    publishedPosts.forEach((post) => {
      post[field]?.forEach((term) => {
        const route = `${getPostLocale(post)}/${routeSegment}/${slug(term)}`
        const lastModified = post.lastmod || post.date
        const currentLastModified = latestByRoute.get(route)

        if (!currentLastModified || new Date(lastModified) > new Date(currentLastModified)) {
          latestByRoute.set(route, lastModified)
        }
      })
    })

    return Array.from(latestByRoute.entries()).map(([route, lastModified]) => ({
      url: `${siteUrl}/${route}`,
      lastModified,
    }))
  }

  const categoryRoutes = termRoutes('categories', 'categories')
  const tagRoutes = termRoutes('tags', 'tags')

  const routes = [
    '',
    'zh',
    'en',
    'zh/blog',
    'en/blog',
    'zh/categories',
    'en/categories',
    'zh/tags',
    'en/tags',
  ].map((route) => ({
    url: `${siteUrl}/${route}`,
    lastModified: new Date().toISOString().split('T')[0],
  }))

  return [...routes, ...categoryRoutes, ...tagRoutes, ...blogRoutes]
}
