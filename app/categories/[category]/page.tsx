import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { allBlogs } from 'contentlayer/generated'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getCategoryCounts, getPostsByLocale, getPostsByCategory, getTagCounts } from '@/lib/blog'
import { sortPosts } from '@/lib/contentlayer'
import { defaultLocale } from '@/lib/i18n'
import { toListPosts } from '@/lib/listPosts'

export async function generateMetadata(props: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const params = await props.params
  const category = decodeURI(params.category)

  return genPageMetadata({
    title: category,
    description: `${siteMetadata.title} ${category} category content`,
  })
}

export const generateStaticParams = async () => {
  const categoryCounts = getCategoryCounts(getPostsByLocale(allBlogs, defaultLocale))

  return Object.keys(categoryCounts).map((category) => ({
    category: encodeURI(category),
  }))
}

export default async function CategoryPage(props: { params: Promise<{ category: string }> }) {
  const params = await props.params
  const category = decodeURI(params.category)
  const title = category[0].toUpperCase() + category.split(' ').join('-').slice(1)
  const localePosts = getPostsByLocale(allBlogs, defaultLocale)
  const filteredPosts = toListPosts(sortPosts(getPostsByCategory(localePosts, category)))

  return (
    <ListLayout
      posts={filteredPosts}
      title={title}
      locale={defaultLocale}
      categoryCounts={getCategoryCounts(localePosts)}
      tagCounts={getTagCounts(localePosts)}
    />
  )
}
