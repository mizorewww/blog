import JsonLd from '@/components/JsonLd'
import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocalizedTagParams, getTagListData } from '@/lib/content/posts'
import { formatTermTitle, termSlug } from '@/lib/content/terms'
import { isLocale, localizePath } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl, decodeRouteParam } from '@/lib/urls'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; tag: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const tag = decodeRouteParam(params.tag)
  return genPageMetadata({
    title: tag,
    description: `${siteMetadata.title} ${tag} tagged content`,
    alternates: {
      canonical: absoluteSiteUrl(
        siteMetadata.siteUrl,
        localizePath(`/tags/${termSlug(tag)}`, params.locale)
      ),
      types: {
        'application/rss+xml': `${siteMetadata.siteUrl}/${params.locale}/tags/${tag}/feed.xml`,
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

  const tag = decodeRouteParam(params.tag)
  const title = formatTermTitle(tag)
  const { posts, categoryCounts, tagCounts } = getTagListData(params.locale, tag)
  const jsonLd = createPostCollectionJsonLd({
    title,
    description: `${siteMetadata.title} ${tag} tagged content`,
    url: absoluteSiteUrl(
      siteMetadata.siteUrl,
      localizePath(`/tags/${termSlug(tag)}`, params.locale)
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
