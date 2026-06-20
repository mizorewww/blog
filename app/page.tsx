import JsonLd from '@/components/JsonLd'
import Main from './Main'
import siteMetadata from '@/data/siteMetadata'
import { genPageMetadata } from './seo'
import { getBlogListData } from '@/lib/content/posts'
import { defaultLocale, ui } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl } from '@/lib/urls'

export const metadata = genPageMetadata({ title: ui[defaultLocale].home })

export default async function Page() {
  const { posts } = getBlogListData(defaultLocale)
  const jsonLd = createPostCollectionJsonLd({
    title: ui[defaultLocale].latest,
    description: siteMetadata.description,
    url: absoluteSiteUrl(siteMetadata.siteUrl),
    locale: defaultLocale,
    posts,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <Main posts={posts} locale={defaultLocale} />
    </>
  )
}
