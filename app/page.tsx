import { sortPosts, allCoreContent } from 'pliny/utils/contentlayer'
import { allBlogs } from 'contentlayer/generated'
import Main from './Main'
import { getPostsByLocale } from '@/lib/blog'
import { defaultLocale } from '@/lib/i18n'

export default async function Page() {
  const sortedPosts = sortPosts(getPostsByLocale(allBlogs, defaultLocale))
  const posts = allCoreContent(sortedPosts)
  return <Main posts={posts} locale={defaultLocale} />
}
