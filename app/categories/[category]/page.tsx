import JsonLd from '@/components/JsonLd'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getCategoryListData, getDefaultCategoryParams } from '@/lib/content/posts'
import { buildTermPageMeta } from '@/lib/content/termPages'
import { defaultLocale } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'

export async function generateMetadata(props: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const params = await props.params
  const termMeta = buildTermPageMeta(defaultLocale, 'categories', params.category)

  return genPageMetadata({
    title: termMeta.term,
    description: termMeta.description,
    alternates: {
      canonical: termMeta.url,
    },
  })
}

export const generateStaticParams = async () => {
  return getDefaultCategoryParams()
}

export default async function CategoryPage(props: { params: Promise<{ category: string }> }) {
  const params = await props.params
  const termMeta = buildTermPageMeta(defaultLocale, 'categories', params.category)
  const { posts, categoryCounts, tagCounts } = getCategoryListData(defaultLocale, termMeta.term)
  const jsonLd = createPostCollectionJsonLd({
    title: termMeta.title,
    description: termMeta.description,
    url: termMeta.url,
    locale: defaultLocale,
    posts,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <ListLayout
        posts={posts}
        title={termMeta.title}
        locale={defaultLocale}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
      />
    </>
  )
}
