import JsonLd from '@/components/JsonLd'
import TermIndexView from '@/components/TermIndexView'
import { notFound } from 'next/navigation'
import { genPageMetadata } from 'app/seo'
import { getLocaleParams } from '@/lib/content/posts'
import { buildTermIndexPageData } from '@/lib/content/termPages'
import { isLocale, ui } from '@/lib/i18n'
import type { Metadata } from 'next'

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
    title: ui[params.locale].allCategories,
    description: 'Article categories',
  })
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params
  const locale = params.locale

  if (!isLocale(locale)) {
    return notFound()
  }

  const data = buildTermIndexPageData(locale, 'categories')

  return (
    <>
      <JsonLd data={data.jsonLd} />
      <TermIndexView
        counts={data.counts}
        field="categories"
        locale={locale}
        sortedTerms={data.sortedTerms}
        title={data.title}
      />
    </>
  )
}
