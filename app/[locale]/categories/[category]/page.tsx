import JsonLd from '@/components/JsonLd'
import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCategoryListData, getLocalizedCategoryParams } from '@/lib/content/posts'
import { formatTermTitle, termSlug } from '@/lib/content/terms'
import { isLocale, localizePath } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl, decodeRouteParam } from '@/lib/urls'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; category: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const category = decodeRouteParam(params.category)
  return genPageMetadata({
    title: category,
    description: `${siteMetadata.title} ${category} category content`,
    alternates: {
      canonical: absoluteSiteUrl(
        siteMetadata.siteUrl,
        localizePath(`/categories/${termSlug(category)}`, params.locale)
      ),
    },
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

  const category = decodeRouteParam(params.category)
  const title = formatTermTitle(category)
  const { posts, categoryCounts, tagCounts } = getCategoryListData(params.locale, category)
  const jsonLd = createPostCollectionJsonLd({
    title,
    description: `${siteMetadata.title} ${category} category content`,
    url: absoluteSiteUrl(
      siteMetadata.siteUrl,
      localizePath(`/categories/${termSlug(category)}`, params.locale)
    ),
    locale: params.locale,
    posts,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <ListLayout
        posts={posts}
        title={title}
        locale={params.locale}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
      />
    </>
  )
}
