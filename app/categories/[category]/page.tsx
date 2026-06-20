import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getCategoryListData, getDefaultCategoryParams } from '@/lib/content/posts'
import { formatTermTitle } from '@/lib/content/terms'
import { defaultLocale } from '@/lib/i18n'

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
  return getDefaultCategoryParams()
}

export default async function CategoryPage(props: { params: Promise<{ category: string }> }) {
  const params = await props.params
  const category = decodeURI(params.category)
  const title = formatTermTitle(category)
  const { posts, categoryCounts, tagCounts } = getCategoryListData(defaultLocale, category)

  return (
    <ListLayout
      posts={posts}
      title={title}
      locale={defaultLocale}
      categoryCounts={categoryCounts}
      tagCounts={tagCounts}
    />
  )
}
