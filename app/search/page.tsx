import { sortPosts } from 'pliny/utils/contentlayer'
import { allBlogs } from 'contentlayer/generated'
import { genPageMetadata } from 'app/seo'
import SearchPanel from '@/components/SearchPanel'
import { getPostsByLocale } from '@/lib/blog'
import { defaultLocale, ui } from '@/lib/i18n'
import { toListPosts } from '@/lib/listPosts'

export const metadata = genPageMetadata({ title: ui[defaultLocale].search })

export default async function SearchPage() {
  const posts = toListPosts(sortPosts(getPostsByLocale(allBlogs, defaultLocale)))

  return <SearchPanel posts={posts} locale={defaultLocale} />
}
