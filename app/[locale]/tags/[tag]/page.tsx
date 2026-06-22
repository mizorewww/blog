import JsonLd from '@/components/JsonLd'
import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocalizedTagParams, getTagListData } from '@/lib/content/posts'
import { buildTermPageMeta } from '@/lib/content/termPages'
import { isLocale } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; tag: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const termMeta = buildTermPageMeta(params.locale, 'tags', params.tag)
  return genPageMetadata({
    title: termMeta.term,
    description: termMeta.description,
    alternates: {
      canonical: termMeta.url,
      types: {
        'application/rss+xml': `${siteMetadata.siteUrl}/${params.locale}/tags/${termMeta.slug}/feed.xml`,
      },
    },
  })
}

export const generateStaticParams = async () => {
  return getLocalizedTagParams()
}

export default async function TagPage(props: { params: Promise<{ locale: string; tag: string }> }) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const termMeta = buildTermPageMeta(params.locale, 'tags', params.tag)
  const { posts, categoryCounts, tagCounts } = getTagListData(params.locale, termMeta.term)
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
