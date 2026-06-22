import JsonLd from '@/components/JsonLd'
import Main from './Main'
import { genPageMetadata } from './seo'
import { buildHomePageData } from '@/lib/content/homePage'
import { defaultLocale, ui } from '@/lib/i18n'

export const metadata = genPageMetadata({ title: ui[defaultLocale].home })

export default async function Page() {
  const data = buildHomePageData(defaultLocale, '/')

  return (
    <>
      <JsonLd data={data.jsonLd} />
      <Main posts={data.posts} locale={defaultLocale} />
    </>
  )
}
