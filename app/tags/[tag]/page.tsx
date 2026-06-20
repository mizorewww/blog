import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { allBlogs } from 'contentlayer/generated'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { getCategoryCounts, getPostsByLocale, getPostsByTag, getTagCounts } from '@/lib/blog'
import { sortPosts } from '@/lib/contentlayer'
import { defaultLocale } from '@/lib/i18n'
import { toListPosts } from '@/lib/listPosts'

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
  const tagCounts = getTagCounts(getPostsByLocale(allBlogs, defaultLocale))
  const tagKeys = Object.keys(tagCounts)
  return tagKeys.map((tag) => ({
    tag: encodeURI(tag),
  }))
}

export default async function TagPage(props: { params: Promise<{ tag: string }> }) {
  const params = await props.params
  const tag = decodeURI(params.tag)
  const title = tag[0].toUpperCase() + tag.split(' ').join('-').slice(1)
  const localePosts = getPostsByLocale(allBlogs, defaultLocale)
  const filteredPosts = toListPosts(sortPosts(getPostsByTag(localePosts, tag)))

  return (
    <ListLayout
      posts={filteredPosts}
      title={title}
      locale={defaultLocale}
      categoryCounts={getCategoryCounts(localePosts)}
      tagCounts={getTagCounts(localePosts)}
    />
  )
}
