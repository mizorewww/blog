import { allAuthors, allBlogs } from 'contentlayer/generated'
import type { Authors, Blog } from 'contentlayer/generated'
import { getPostLocale, getPostsByLocale, isPublishedPost } from '@/lib/blog'
import { coreContent, sortPosts, type CoreContent } from '@/lib/contentlayer'
import { defaultLocale, locales, type Locale } from '@/lib/i18n'
import { toListPosts, toPostNavItem, type BlogListPost } from '@/lib/listPosts'
import { normalizeTocHeadings } from '@/lib/toc'
import { buildContentTree, type ContentTreeNode } from '@/lib/content/contentTree'
import {
  getCategoryCounts,
  getPostsByTerm,
  getTagCounts,
  getTermCounts,
  getTermKeys,
  type CountMap,
  type TermField,
} from '@/lib/content/terms'

export type BlogListData = {
  sourcePosts: Blog[]
  posts: BlogListPost[]
  contentTree: ContentTreeNode[]
  categoryCounts: CountMap
  tagCounts: CountMap
}

function toContentTree(posts: Blog[]) {
  return buildContentTree(
    posts.map((post) => ({
      title: post.title,
      slug: post.slug,
      path: post.path,
      date: post.date,
    }))
  )
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
    contentTree: toContentTree(sourcePosts),
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
    contentTree: toContentTree(sourcePosts),
    categoryCounts: getCategoryCounts(sourcePosts),
    tagCounts: getTagCounts(sourcePosts),
  }
}

export function getPostPageData(locale: Locale, slug: string) {
  const sortedPosts = sortPosts(getLocalePosts(locale))
  const postIndex = sortedPosts.findIndex((candidate) => candidate.slug === slug)
  const post = sortedPosts[postIndex]

  if (!post) {
    return null
  }

  const previousPost = sortedPosts[postIndex + 1]
  const nextPost = sortedPosts[postIndex - 1]

  return {
    post,
    authorDetails: getAuthorDetails(post.authors || ['default']),
    toc: normalizeTocHeadings(post.toc),
    previousPost: previousPost ? toPostNavItem(previousPost) : null,
    nextPost: nextPost ? toPostNavItem(nextPost) : null,
    contentTree: toContentTree(sortedPosts),
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

export type CategoryParam = { locale: Locale; category: string }
export type TagParam = { locale: Locale; tag: string }

export function getDefaultCategoryParams(): CategoryParam[] {
  return getTermParams(null, 'categories') as CategoryParam[]
}

export function getLocalizedCategoryParams(): CategoryParam[] {
  return locales.flatMap((locale) => getTermParams(locale, 'categories') as CategoryParam[])
}

export function getDefaultTagParams(): TagParam[] {
  return getTermParams(null, 'tags') as TagParam[]
}

export function getLocalizedTagParams(): TagParam[] {
  return locales.flatMap((locale) => getTermParams(locale, 'tags') as TagParam[])
}

export function getTermParams(locale: Locale | null, field: TermField) {
  const targetLocale = locale || defaultLocale
  const counts = getTermCounts(getLocalePosts(targetLocale), field)
  const keys = getTermKeys(counts)

  if (field === 'categories') {
    return keys.map((term) => ({ locale: targetLocale, category: term }))
  }

  return keys.map((term) => ({ locale: targetLocale, tag: term }))
}

export function getTermParamsForLocales(field: TermField): CategoryParam[] | TagParam[] {
  if (field === 'categories') {
    return getLocalizedCategoryParams()
  }

  return getLocalizedTagParams()
}

export function getPublishedSitemapPosts() {
  return allBlogs.filter(isPublishedPost).map((post) => ({
    ...post,
    locale: getPostLocale(post),
  }))
}
