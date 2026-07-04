import SearchPageClient from '@/components/SearchPageClient'
import siteMetadata from '@/data/siteMetadata'
import { isLocale, locales, ui } from '@/lib/i18n'
import { localizedAlternates } from '@/lib/seo/alternates'
import { genPageMetadata } from 'app/seo'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const generateStaticParams = async () => locales.map((locale) => ({ locale }))

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  return genPageMetadata({
    title: ui[params.locale].search,
    description: ui[params.locale].searchDescription,
    locale: params.locale,
    alternates: localizedAlternates(siteMetadata.siteUrl),
  })
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  return <SearchPageClient locale={params.locale} />
}
