import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getDefaultTagParams, getTagListData } from '@/lib/content/posts'
import { formatTermTitle } from '@/lib/content/terms'
import { defaultLocale } from '@/lib/i18n'

export async function generateMetadata(props: {
  params: Promise<{ tag: string }>
}): Promise<Metadata> {
  const params = await props.params
  const tag = decodeURI(params.tag)
  return genPageMetadata({
    title: tag,
    description: `${siteMetadata.title} ${tag} tagged content`,
    alternates: {
      canonical: './',
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
  const tag = decodeURI(params.tag)
  const title = formatTermTitle(tag)
  const { posts, categoryCounts, tagCounts } = getTagListData(defaultLocale, tag)

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
