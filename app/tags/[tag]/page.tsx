import JsonLd from '@/components/JsonLd'
import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getDefaultTagParams, getTagListData } from '@/lib/content/posts'
import { formatTermTitle, termSlug } from '@/lib/content/terms'
import { defaultLocale, localizePath } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl, decodeRouteParam } from '@/lib/urls'

export async function generateMetadata(props: {
  params: Promise<{ tag: string }>
}): Promise<Metadata> {
  const params = await props.params
  const tag = decodeRouteParam(params.tag)
  return genPageMetadata({
    title: tag,
    description: `${siteMetadata.title} ${tag} tagged content`,
    alternates: {
      canonical: absoluteSiteUrl(
        siteMetadata.siteUrl,
        localizePath(`/tags/${termSlug(tag)}`, defaultLocale)
      ),
      types: {
        'application/rss+xml': `${siteMetadata.siteUrl}/tags/${tag}/feed.xml`,
      },
    },
  })
}

export const generateStaticParams = async () => {
  return getDefaultTagParams()
}

export default async function TagPage(props: { params: Promise<{ tag: string }> }) {
  const params = await props.params
  const tag = decodeRouteParam(params.tag)
  const title = formatTermTitle(tag)
  const { posts, categoryCounts, tagCounts } = getTagListData(defaultLocale, tag)
  const jsonLd = createPostCollectionJsonLd({
    title,
    description: `${siteMetadata.title} ${tag} tagged content`,
    url: absoluteSiteUrl(
      siteMetadata.siteUrl,
      localizePath(`/tags/${termSlug(tag)}`, defaultLocale)
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
