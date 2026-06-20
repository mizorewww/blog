import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { allBlogs } from 'contentlayer/generated'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCategoryCounts, getPostsByLocale, getPostsByCategory, getTagCounts } from '@/lib/blog'
import { sortPosts } from '@/lib/contentlayer'
import { isLocale, locales } from '@/lib/i18n'
import { toListPosts } from '@/lib/listPosts'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; category: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const category = decodeURI(params.category)
  return genPageMetadata({
    title: category,
    description: `${siteMetadata.title} ${category} category content`,
  })
}

export const generateStaticParams = async () => {
  return locales.flatMap((locale) => {
    const categoryCounts = getCategoryCounts(getPostsByLocale(allBlogs, locale))
    return Object.keys(categoryCounts).map((category) => ({
      locale,
      category: encodeURI(category),
    }))
  })
}

export default async function CategoryPage(props: {
  params: Promise<{ locale: string; category: string }>
}) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const category = decodeURI(params.category)
  const title = category[0].toUpperCase() + category.split(' ').join('-').slice(1)
  const localePosts = getPostsByLocale(allBlogs, params.locale)
  const filteredPosts = toListPosts(sortPosts(getPostsByCategory(localePosts, category)))

  return (
    <ListLayout
      posts={filteredPosts}
      title={title}
      locale={params.locale}
      categoryCounts={getCategoryCounts(localePosts)}
      tagCounts={getTagCounts(localePosts)}
    />
  )
}
