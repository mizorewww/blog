import { allCoreContent, sortPosts } from 'pliny/utils/contentlayer'
import { allBlogs } from 'contentlayer/generated'
import { notFound } from 'next/navigation'
import { genPageMetadata } from 'app/seo'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { getPostsByLocale, getTagCounts } from '@/lib/blog'
import { isLocale, localeConfig, locales, ui } from '@/lib/i18n'
import type { Metadata } from 'next'

export const generateStaticParams = async () => {
  return locales.map((locale) => ({ locale }))
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  return genPageMetadata({
    title: ui[params.locale].blog,
    openGraph: {
      locale: localeConfig[params.locale].htmlLang.replace('-', '_'),
    },
  })
}

export default async function BlogPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const localePosts = getPostsByLocale(allBlogs, params.locale)
  const posts = allCoreContent(sortPosts(localePosts))

  return (
    <ListLayout
      posts={posts}
      title={ui[params.locale].allPosts}
      locale={params.locale}
      tagCounts={getTagCounts(localePosts)}
    />
  )
}
