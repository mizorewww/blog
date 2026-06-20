import { allBlogs } from 'contentlayer/generated'
import { notFound } from 'next/navigation'
import Main from '../Main'
import { getPostsByLocale } from '@/lib/blog'
import { sortPosts } from '@/lib/contentlayer'
import { isLocale, localeConfig, locales, ui } from '@/lib/i18n'
import { genPageMetadata } from 'app/seo'
import type { Metadata } from 'next'
import { toListPosts } from '@/lib/listPosts'

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
    title: ui[params.locale].home,
    openGraph: {
      locale: localeConfig[params.locale].htmlLang.replace('-', '_'),
    },
  })
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const sortedPosts = sortPosts(getPostsByLocale(allBlogs, params.locale))
  const posts = toListPosts(sortedPosts)

  return <Main posts={posts} locale={params.locale} />
}
