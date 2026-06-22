import JsonLd from '@/components/JsonLd'
import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getDefaultTagParams, getTagListData } from '@/lib/content/posts'
import { buildTermPageMeta } from '@/lib/content/termPages'
import { defaultLocale } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'

export async function generateMetadata(props: {
  params: Promise<{ tag: string }>
}): Promise<Metadata> {
  const params = await props.params
  const termMeta = buildTermPageMeta(defaultLocale, 'tags', params.tag)
  return genPageMetadata({
    title: termMeta.term,
    description: termMeta.description,
    alternates: {
      canonical: termMeta.url,
      types: {
        'application/rss+xml': `${siteMetadata.siteUrl}/tags/${termMeta.slug}/feed.xml`,
      },
    },
  })
}

export const generateStaticParams = async () => {
  return getDefaultTagParams()
}

export default async function TagPage(props: { params: Promise<{ tag: string }> }) {
  const params = await props.params
  const termMeta = buildTermPageMeta(defaultLocale, 'tags', params.tag)
  const { posts, categoryCounts, tagCounts } = getTagListData(defaultLocale, termMeta.term)
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
