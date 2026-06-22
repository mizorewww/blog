import JsonLd from '@/components/JsonLd'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCategoryListData, getLocalizedCategoryParams } from '@/lib/content/posts'
import { buildTermPageMeta } from '@/lib/content/termPages'
import { isLocale } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; category: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const termMeta = buildTermPageMeta(params.locale, 'categories', params.category)
  return genPageMetadata({
    title: termMeta.term,
    description: termMeta.description,
    alternates: {
      canonical: termMeta.url,
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

  const termMeta = buildTermPageMeta(params.locale, 'categories', params.category)
  const { posts, categoryCounts, tagCounts } = getCategoryListData(params.locale, termMeta.term)
  const jsonLd = createPostCollectionJsonLd({
    title: termMeta.title,
    description: termMeta.description,
    url: termMeta.url,
    locale: params.locale,
    posts,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <ListLayout
        posts={posts}
        title={termMeta.title}
        locale={params.locale}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
      />
    </>
  )
}
