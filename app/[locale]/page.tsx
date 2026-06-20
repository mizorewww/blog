import JsonLd from '@/components/JsonLd'
import { notFound } from 'next/navigation'
import Main from '../Main'
import siteMetadata from '@/data/siteMetadata'
import { isLocale, localeConfig, ui } from '@/lib/i18n'
import { genPageMetadata } from 'app/seo'
import type { Metadata } from 'next'
import { getBlogListData, getLocaleParams } from '@/lib/content/posts'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl } from '@/lib/urls'

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
  const jsonLd = createPostCollectionJsonLd({
    title: ui[params.locale].latest,
    description: siteMetadata.description,
    url: absoluteSiteUrl(siteMetadata.siteUrl, params.locale),
    locale: params.locale,
    posts,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <Main posts={posts} locale={params.locale} />
    </>
  )
}
