import { allAuthors, allBlogs } from 'contentlayer/generated'
import type { Authors, Blog } from 'contentlayer/generated'
import { getPostLocale, getPostsByLocale, isPublishedPost } from '@/lib/blog'
import { coreContent, sortPosts, type CoreContent } from '@/lib/contentlayer'
import { defaultLocale, locales, type Locale } from '@/lib/i18n'
import { toListPosts, type BlogListPost } from '@/lib/listPosts'
import {
  getCategoryCounts,
  getPostsByCategory,
  getPostsByTag,
  getTagCounts,
  getTermKeys,
  type CountMap,
} from '@/lib/content/terms'

type ListPostOptions = Parameters<typeof toListPosts>[1]

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

export function getBlogListData(locale: Locale, options: ListPostOptions = {}): BlogListData {
  const sourcePosts = getLocalePosts(locale)

  return {
    sourcePosts,
    posts: toListPosts(sortPosts(sourcePosts), options),
    categoryCounts: getCategoryCounts(sourcePosts),
    tagCounts: getTagCounts(sourcePosts),
  }
}

export function getCategoryListData(locale: Locale, category: string): BlogListData {
  const sourcePosts = getLocalePosts(locale)
  const filteredPosts = getPostsByCategory(sourcePosts, category)

  return {
    sourcePosts,
    posts: toListPosts(sortPosts(filteredPosts)),
    categoryCounts: getCategoryCounts(sourcePosts),
    tagCounts: getTagCounts(sourcePosts),
  }
}

export function getTagListData(locale: Locale, tag: string): BlogListData {
  const sourcePosts = getLocalePosts(locale)
  const filteredPosts = getPostsByTag(sourcePosts, tag)

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

  const listData = getBlogListData(locale, {
    includeBodyCode: (item) => item.path === post.path,
  })

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
  return getTermKeys(getCategoryCounts(getLocalePosts(defaultLocale))).map((category) => ({
    category: encodeURI(category),
  }))
}

export function getLocalizedCategoryParams() {
  return locales.flatMap((locale) =>
    getTermKeys(getCategoryCounts(getLocalePosts(locale))).map((category) => ({
      locale,
      category: encodeURI(category),
    }))
  )
}

export function getDefaultTagParams() {
  return getTermKeys(getTagCounts(getLocalePosts(defaultLocale))).map((tag) => ({
    tag: encodeURI(tag),
  }))
}

export function getLocalizedTagParams() {
  return locales.flatMap((locale) =>
    getTermKeys(getTagCounts(getLocalePosts(locale))).map((tag) => ({
      locale,
      tag: encodeURI(tag),
    }))
  )
}

export function getPublishedSitemapPosts() {
  return allBlogs.filter(isPublishedPost).map((post) => ({
    ...post,
    locale: getPostLocale(post),
  }))
}
