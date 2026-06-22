import { defaultLocale, isLocale, type Locale } from './i18n.ts'

type BlogLike = {
  draft?: boolean
  locale?: string
  language?: string
  slug: string
  path?: string
  categories?: string[]
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
