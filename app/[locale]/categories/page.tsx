import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { genPageMetadata } from 'app/seo'
import { getBlogListData, getLocaleParams } from '@/lib/content/posts'
import { isLocale, locales, localizePath, ui } from '@/lib/i18n'
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

  const { categoryCounts } = getBlogListData(locale)
  const categoryKeys = Object.keys(categoryCounts)
  const sortedCategories = categoryKeys.sort((a, b) => categoryCounts[b] - categoryCounts[a])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-start justify-start px-4 pt-10 pb-16 sm:px-6 md:mt-24 md:flex-row md:items-center md:justify-center md:space-x-6">
      <div className="space-x-2 pt-6 pb-8 md:space-y-5">
        <h1 className="text-3xl leading-9 font-extrabold tracking-tight text-gray-900 sm:text-4xl sm:leading-10 md:border-r-2 md:px-6 md:text-6xl md:leading-14 dark:text-gray-100">
          {ui[locale].allCategories}
        </h1>
      </div>
      <div className="flex max-w-lg flex-wrap">
        {categoryKeys.length === 0 && ui[locale].noCategories}
        {sortedCategories.map((category) => (
          <Link
            key={category}
            href={localizePath(`/categories/${category}`, locale)}
            className="mt-2 mr-3 mb-2 rounded-[8px] bg-white px-4 py-2 text-slate-700 transition hover:bg-sky-500 hover:text-white dark:bg-[#252d38] dark:text-white/80 dark:hover:bg-sky-500"
            aria-label={ui[locale].postsInCategory(category)}
          >
            {category} ({categoryCounts[category]})
          </Link>
        ))}
      </div>
    </div>
  )
}
