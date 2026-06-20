import { allBlogs } from 'contentlayer/generated'
import Main from './Main'
import { getPostsByLocale } from '@/lib/blog'
import { sortPosts } from '@/lib/contentlayer'
import { defaultLocale } from '@/lib/i18n'
import { toListPosts } from '@/lib/listPosts'

export default async function Page() {
  const sortedPosts = sortPosts(getPostsByLocale(allBlogs, defaultLocale))
  const posts = toListPosts(sortedPosts)
  return <Main posts={posts} locale={defaultLocale} />
}
