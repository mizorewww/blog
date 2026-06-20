import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { allBlogs } from 'contentlayer/generated'
import { genPageMetadata } from 'app/seo'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCategoryCounts, getPostsByLocale, getPostsByTag, getTagCounts } from '@/lib/blog'
import { sortPosts } from '@/lib/contentlayer'
import { isLocale, locales } from '@/lib/i18n'
import { toListPosts } from '@/lib/listPosts'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; tag: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const tag = decodeURI(params.tag)
  return genPageMetadata({
    title: tag,
    description: `${siteMetadata.title} ${tag} tagged content`,
    alternates: {
      canonical: './',
      types: {
        'application/rss+xml': `${siteMetadata.siteUrl}/${params.locale}/tags/${tag}/feed.xml`,
      },
    },
  })
}

export const generateStaticParams = async () => {
  return locales.flatMap((locale) => {
    const tagCounts = getTagCounts(getPostsByLocale(allBlogs, locale))
    return Object.keys(tagCounts).map((tag) => ({
      locale,
      tag: encodeURI(tag),
    }))
  })
}

export default async function TagPage(props: { params: Promise<{ locale: string; tag: string }> }) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const tag = decodeURI(params.tag)
  const title = tag[0].toUpperCase() + tag.split(' ').join('-').slice(1)
  const localePosts = getPostsByLocale(allBlogs, params.locale)
  const filteredPosts = toListPosts(sortPosts(getPostsByTag(localePosts, tag)))

  return (
    <ListLayout
      posts={filteredPosts}
      title={title}
      locale={params.locale}
      categoryCounts={getCategoryCounts(localePosts)}
      tagCounts={getTagCounts(localePosts)}
    />
  )
}
