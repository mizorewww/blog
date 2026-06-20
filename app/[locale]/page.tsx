import { notFound } from 'next/navigation'
import Main from '../Main'
import { isLocale, localeConfig, ui } from '@/lib/i18n'
import { genPageMetadata } from 'app/seo'
import type { Metadata } from 'next'
import { getBlogListData, getLocaleParams } from '@/lib/content/posts'

export const generateStaticParams = async () => {
  return getLocaleParams()
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

  const { posts } = getBlogListData(params.locale)

  return <Main posts={posts} locale={params.locale} />
}
