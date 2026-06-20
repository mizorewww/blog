import { allBlogs } from 'contentlayer/generated'
import { genPageMetadata } from 'app/seo'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { getCategoryCounts, getPostsByLocale, getTagCounts } from '@/lib/blog'
import { sortPosts } from '@/lib/contentlayer'
import { defaultLocale, ui } from '@/lib/i18n'
import { toListPosts } from '@/lib/listPosts'

export const metadata = genPageMetadata({ title: 'Blog' })

export default async function BlogPage() {
  const localePosts = getPostsByLocale(allBlogs, defaultLocale)
  const posts = toListPosts(sortPosts(localePosts))

  return (
    <ListLayout
      posts={posts}
      title={ui[defaultLocale].allPosts}
      locale={defaultLocale}
      categoryCounts={getCategoryCounts(localePosts)}
      tagCounts={getTagCounts(localePosts)}
    />
  )
}
