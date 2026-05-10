import { slug } from 'github-slugger'
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n'

type BlogLike = {
  draft?: boolean
  locale?: string
  language?: string
  slug: string
  path?: string
  tags?: string[]
}

export function isPublishedPost(post: BlogLike) {
  return process.env.NODE_ENV !== 'production' || post.draft !== true
}

export function getPostLocale(post: Pick<BlogLike, 'locale' | 'language'>): Locale {
  if (isLocale(post.locale)) {
    return post.locale
  }

  if (isLocale(post.language)) {
    return post.language
  }

  return defaultLocale
}

export function getPostsByLocale<T extends BlogLike>(posts: T[], locale: Locale): T[] {
  return posts.filter((post) => isPublishedPost(post) && getPostLocale(post) === locale)
}

export function getPostByLocaleAndSlug<T extends BlogLike>(
  posts: T[],
  locale: Locale,
  postSlug: string
): T | undefined {
  return getPostsByLocale(posts, locale).find((post) => post.slug === postSlug)
}

export function getTagCounts(posts: BlogLike[]): Record<string, number> {
  return posts.reduce<Record<string, number>>((counts, post) => {
    post.tags?.forEach((tag) => {
      const formattedTag = slug(tag)
      counts[formattedTag] = (counts[formattedTag] || 0) + 1
    })

    return counts
  }, {})
}

export function getPostsByTag<T extends BlogLike>(posts: T[], tag: string): T[] {
  return posts.filter((post) => post.tags?.map((postTag) => slug(postTag)).includes(tag))
}

export function getPostHref(post: BlogLike): string {
  if (post.path) {
    return `/${post.path}`
  }

  return `/${getPostLocale(post)}/blog/${post.slug}`
}
