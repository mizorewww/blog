import { allCoreContent, sortPosts } from 'pliny/utils/contentlayer'
import { allBlogs } from 'contentlayer/generated'
import { genPageMetadata } from 'app/seo'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { getPostsByLocale, getTagCounts } from '@/lib/blog'
import { defaultLocale, ui } from '@/lib/i18n'

export const metadata = genPageMetadata({ title: 'Blog' })

export default async function BlogPage() {
  const localePosts = getPostsByLocale(allBlogs, defaultLocale)
  const posts = allCoreContent(sortPosts(localePosts))

  return (
    <ListLayout
      posts={posts}
      title={ui[defaultLocale].allPosts}
      locale={defaultLocale}
      tagCounts={getTagCounts(localePosts)}
    />
  )
}
