import JsonLd from '@/components/JsonLd'
import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getCategoryListData, getDefaultCategoryParams } from '@/lib/content/posts'
import { formatTermTitle, termSlug } from '@/lib/content/terms'
import { defaultLocale, localizePath } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl, decodeRouteParam } from '@/lib/urls'

export async function generateMetadata(props: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const params = await props.params
  const category = decodeRouteParam(params.category)

  return genPageMetadata({
    title: category,
    description: `${siteMetadata.title} ${category} category content`,
    alternates: {
      canonical: absoluteSiteUrl(
        siteMetadata.siteUrl,
        localizePath(`/categories/${termSlug(category)}`, defaultLocale)
      ),
    },
  })
}

export const generateStaticParams = async () => {
  return getDefaultCategoryParams()
}

export default async function CategoryPage(props: { params: Promise<{ category: string }> }) {
  const params = await props.params
  const category = decodeRouteParam(params.category)
  const title = formatTermTitle(category)
  const { posts, categoryCounts, tagCounts } = getCategoryListData(defaultLocale, category)
  const jsonLd = createPostCollectionJsonLd({
    title,
    description: `${siteMetadata.title} ${category} category content`,
    url: absoluteSiteUrl(
      siteMetadata.siteUrl,
      localizePath(`/categories/${termSlug(category)}`, defaultLocale)
    ),
    locale: defaultLocale,
    posts,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <ListLayout
        posts={posts}
        title={title}
        locale={defaultLocale}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
      />
    </>
  )
}
