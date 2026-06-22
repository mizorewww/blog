import JsonLd from '@/components/JsonLd'
import TermIndexView from '@/components/TermIndexView'
import { genPageMetadata } from 'app/seo'
import { buildTermIndexPageData } from '@/lib/content/termPages'
import { defaultLocale, ui } from '@/lib/i18n'

export const metadata = genPageMetadata({
  title: ui[defaultLocale].allCategories,
  description: 'Article categories',
})

export default async function Page() {
  const data = buildTermIndexPageData(defaultLocale, 'categories')

  return (
    <>
      <JsonLd data={data.jsonLd} />
      <TermIndexView
        counts={data.counts}
        field="categories"
        locale={defaultLocale}
        sortedTerms={data.sortedTerms}
        title={data.title}
      />
    </>
  )
}
