import Link from '@/components/Link'
import Tag from '@/components/Tag'
import { slug } from 'github-slugger'
import { allBlogs } from 'contentlayer/generated'
import { notFound } from 'next/navigation'
import { genPageMetadata } from 'app/seo'
import { getPostsByLocale, getTagCounts } from '@/lib/blog'
import { isLocale, locales, localizePath, ui } from '@/lib/i18n'
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
    title: ui[params.locale].allTags,
    description: 'Things I blog about',
  })
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params
  const locale = params.locale

  if (!isLocale(locale)) {
    return notFound()
  }

  const tagCounts = getTagCounts(getPostsByLocale(allBlogs, locale))
  const tagKeys = Object.keys(tagCounts)
  const sortedTags = tagKeys.sort((a, b) => tagCounts[b] - tagCounts[a])

  return (
    <>
      <div className="flex flex-col items-start justify-start divide-y divide-gray-200 md:mt-24 md:flex-row md:items-center md:justify-center md:space-x-6 md:divide-y-0 dark:divide-gray-700">
        <div className="space-x-2 pt-6 pb-8 md:space-y-5">
          <h1 className="text-3xl leading-9 font-extrabold tracking-tight text-gray-900 sm:text-4xl sm:leading-10 md:border-r-2 md:px-6 md:text-6xl md:leading-14 dark:text-gray-100">
            {ui[locale].allTags}
          </h1>
        </div>
        <div className="flex max-w-lg flex-wrap">
          {tagKeys.length === 0 && ui[locale].noTags}
          {sortedTags.map((tag) => {
            return (
              <div key={tag} className="mt-2 mr-5 mb-2">
                <Tag text={tag} locale={locale} />
                <Link
                  href={localizePath(`/tags/${slug(tag)}`, locale)}
                  className="-ml-2 text-sm font-semibold text-gray-600 uppercase dark:text-gray-300"
                  aria-label={ui[locale].postsTagged(tag)}
                >
                  {` (${tagCounts[tag]})`}
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
