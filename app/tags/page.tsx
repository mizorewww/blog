import JsonLd from '@/components/JsonLd'
import Link from '@/components/Link'
import Tag from '@/components/Tag'
import siteMetadata from '@/data/siteMetadata'
import { genPageMetadata } from 'app/seo'
import { getBlogListData } from '@/lib/content/posts'
import { defaultLocale, localizePath, ui } from '@/lib/i18n'
import { createTermCollectionJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl } from '@/lib/urls'

export const metadata = genPageMetadata({ title: 'Tags', description: 'Things I blog about' })

export default async function Page() {
  const { tagCounts } = getBlogListData(defaultLocale)
  const tagKeys = Object.keys(tagCounts)
  const sortedTags = tagKeys.sort((a, b) => tagCounts[b] - tagCounts[a])
  const jsonLd = createTermCollectionJsonLd({
    title: ui[defaultLocale].allTags,
    description: 'Things I blog about',
    url: absoluteSiteUrl(siteMetadata.siteUrl, localizePath('/tags', defaultLocale)),
    locale: defaultLocale,
    items: sortedTags.map((tag) => ({
      name: tag,
      url: absoluteSiteUrl(siteMetadata.siteUrl, localizePath(`/tags/${tag}`, defaultLocale)),
      description: `${tagCounts[tag]} articles`,
    })),
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <div className="flex flex-col items-start justify-start divide-y divide-gray-200 md:mt-24 md:flex-row md:items-center md:justify-center md:space-x-6 md:divide-y-0 dark:divide-gray-700">
        <div className="space-x-2 pt-6 pb-8 md:space-y-5">
          <h1 className="text-3xl leading-9 font-extrabold tracking-tight text-gray-900 sm:text-4xl sm:leading-10 md:border-r-2 md:px-6 md:text-6xl md:leading-14 dark:text-gray-100">
            {ui[defaultLocale].allTags}
          </h1>
        </div>
        <div className="flex max-w-lg flex-wrap">
          {tagKeys.length === 0 && ui[defaultLocale].noTags}
          {sortedTags.map((t) => {
            return (
              <div key={t} className="mt-2 mr-5 mb-2">
                <Tag text={t} locale={defaultLocale} />
                <Link
                  href={localizePath(`/tags/${t}`, defaultLocale)}
                  className="-ml-2 text-sm font-semibold text-gray-600 uppercase dark:text-gray-300"
                  aria-label={ui[defaultLocale].postsTagged(t)}
                >
                  {` (${tagCounts[t]})`}
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
