import { allAuthors, allBlogs } from 'contentlayer/generated'
import type { Authors, Blog } from 'contentlayer/generated'
import { getPostLocale, getPostsByLocale, isPublishedPost } from '@/lib/blog'
import { coreContent, sortPosts, type CoreContent } from '@/lib/contentlayer'
import { defaultLocale, locales, type Locale } from '@/lib/i18n'
import { toListPosts, type BlogListPost } from '@/lib/listPosts'
import {
  getCategoryCounts,
  getPostsByTerm,
  getTagCounts,
  getTermCounts,
  getTermKeys,
  getTermRouteField,
  type CountMap,
  type TermField,
} from '@/lib/content/terms'

export type BlogListData = {
  sourcePosts: Blog[]
  posts: BlogListPost[]
  categoryCounts: CountMap
  tagCounts: CountMap
}

export function getLocalePosts(locale: Locale) {
  return getPostsByLocale(allBlogs, locale)
}

export function getPostBySlug(locale: Locale, slug: string) {
  return getLocalePosts(locale).find((post) => post.slug === slug)
}

export function getAuthorDetails(authorIds: string[] = ['default']): CoreContent<Authors>[] {
  const fallbackAuthor = allAuthors.find((author) => author.slug === 'default')

  return authorIds
    .map((authorId) => allAuthors.find((author) => author.slug === authorId) || fallbackAuthor)
    .filter((author): author is Authors => Boolean(author))
    .map(coreContent)
}

export function getBlogListData(locale: Locale): BlogListData {
  const sourcePosts = getLocalePosts(locale)

  return {
    sourcePosts,
    posts: toListPosts(sortPosts(sourcePosts)),
    categoryCounts: getCategoryCounts(sourcePosts),
    tagCounts: getTagCounts(sourcePosts),
  }
}

export function getCategoryListData(locale: Locale, category: string): BlogListData {
  return getTermListData(locale, 'categories', category)
}

export function getTagListData(locale: Locale, tag: string): BlogListData {
  return getTermListData(locale, 'tags', tag)
}

export function getTermListData(locale: Locale, field: TermField, term: string): BlogListData {
  const sourcePosts = getLocalePosts(locale)
  const filteredPosts = getPostsByTerm(sourcePosts, field, term)

  return {
    sourcePosts,
    posts: toListPosts(sortPosts(filteredPosts)),
    categoryCounts: getCategoryCounts(sourcePosts),
    tagCounts: getTagCounts(sourcePosts),
  }
}

export function getPostPageData(locale: Locale, slug: string) {
  const post = getPostBySlug(locale, slug)

  if (!post) {
    return null
  }

  const listData = getBlogListData(locale)

  return {
    post,
    authorDetails: getAuthorDetails(post.authors || ['default']),
    listData,
  }
}

export function getLocaleParams() {
  return locales.map((locale) => ({ locale }))
}

export function getLocalizedPostParams() {
  return locales.flatMap((locale) =>
    getLocalePosts(locale).map((post) => ({
      locale,
      slug: post.slug.split('/').map((name) => decodeURI(name)),
    }))
  )
}

export function getDefaultCategoryParams() {
  return getTermParams(null, 'categories')
}

export function getLocalizedCategoryParams() {
  return getTermParamsForLocales('categories')
}

export function getDefaultTagParams() {
  return getTermParams(null, 'tags')
}

export function getLocalizedTagParams() {
  return getTermParamsForLocales('tags')
}

export function getTermParams(locale: Locale | null, field: TermField) {
  const targetLocale = locale || defaultLocale
  const routeField = getTermRouteField(field)
  const counts = getTermCounts(getLocalePosts(targetLocale), field)

  return getTermKeys(counts).map((term) => ({
    ...(locale ? { locale } : {}),
    [routeField]: encodeURI(term),
  }))
}

export function getTermParamsForLocales(field: TermField) {
  return locales.flatMap((locale) => getTermParams(locale, field))
}

export function getPublishedSitemapPosts() {
  return allBlogs.filter(isPublishedPost).map((post) => ({
    ...post,
    locale: getPostLocale(post),
  }))
}
