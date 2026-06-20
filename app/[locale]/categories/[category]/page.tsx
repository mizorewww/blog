import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCategoryListData, getLocalizedCategoryParams } from '@/lib/content/posts'
import { formatTermTitle } from '@/lib/content/terms'
import { isLocale } from '@/lib/i18n'

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
  return getLocalizedCategoryParams()
}

export default async function CategoryPage(props: {
  params: Promise<{ locale: string; category: string }>
}) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const category = decodeURI(params.category)
  const title = formatTermTitle(category)
  const { posts, categoryCounts, tagCounts } = getCategoryListData(params.locale, category)

  return (
    <ListLayout
      posts={posts}
      title={title}
      locale={params.locale}
      categoryCounts={categoryCounts}
      tagCounts={tagCounts}
    />
  )
}
