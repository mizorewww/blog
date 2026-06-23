import Link from '@/components/Link'
import Tag from '@/components/Tag'
import type { TermField, TermSummary } from '@/lib/content/terms'
import { localizePath, type Locale, ui } from '@/lib/i18n'

export default function TermIndexView({
  field,
  locale,
  terms,
  title,
}: {
  field: TermField
  locale: Locale
  terms: TermSummary[]
  title: string
}) {
  const isCategory = field === 'categories'
  const labels = ui[locale]
  const emptyLabel = isCategory ? labels.noCategories : labels.noTags
  const route = isCategory ? '/categories' : '/tags'
  const containerClass = isCategory
    ? 'mx-auto flex w-full max-w-5xl flex-col items-start justify-start px-4 pt-10 pb-16 sm:px-6 md:mt-24 md:flex-row md:items-center md:justify-center md:space-x-6'
    : 'flex flex-col items-start justify-start divide-y divide-gray-200 md:mt-24 md:flex-row md:items-center md:justify-center md:space-x-6 md:divide-y-0 dark:divide-gray-700'

  return (
    <div className={containerClass}>
      <div className="space-x-2 pt-6 pb-8 md:space-y-5">
        <h1 className="text-3xl leading-9 font-extrabold tracking-tight text-gray-900 sm:text-4xl sm:leading-10 md:border-r-2 md:px-6 md:text-6xl md:leading-14 dark:text-gray-100">
          {title}
        </h1>
      </div>
      <div className="flex max-w-lg flex-wrap">
        {terms.length === 0 && emptyLabel}
        {terms.map((term) =>
          isCategory ? (
            <Link
              key={term.slug}
              href={localizePath(`${route}/${term.slug}`, locale)}
              className="dark:bg-surface-card-dark mt-2 mr-3 mb-2 rounded-[8px] bg-white px-4 py-2 text-slate-700 transition hover:bg-sky-500 hover:text-white dark:text-white/80 dark:hover:bg-sky-500"
              aria-label={labels.postsInCategory(term.label)}
            >
              {term.label} ({term.count})
            </Link>
          ) : (
            <div key={term.slug} className="mt-2 mr-5 mb-2">
              <Tag text={term.label} locale={locale} />
              <Link
                href={localizePath(`${route}/${term.slug}`, locale)}
                className="-ml-2 text-sm font-semibold text-gray-600 uppercase dark:text-gray-300"
                aria-label={labels.postsTagged(term.label)}
              >
                {` (${term.count})`}
              </Link>
            </div>
          )
        )}
      </div>
    </div>
  )
}
