import Link from '@/components/Link'
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

  return (
    <div className="blog-shell mx-auto w-full px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
      <h1 className="mb-5 text-2xl leading-tight font-semibold tracking-tight text-slate-900 sm:mb-8 sm:text-4xl dark:text-white/90">
        {title}
      </h1>

      {terms.length === 0 ? (
        <p className="text-slate-500 dark:text-white/60">{emptyLabel}</p>
      ) : isCategory ? (
        <div className="flex flex-wrap gap-3">
          {terms.map((term) => (
            <Link
              key={term.slug}
              href={localizePath(`${route}/${term.slug}`, locale)}
              data-term-chip
              className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-[8px] bg-white/76 px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200/70 hover:text-sky-700 hover:ring-sky-400 motion-safe:transition-[box-shadow,color,background-color] motion-safe:duration-200 motion-safe:ease-out dark:bg-white/[0.045] dark:text-white/76 dark:ring-white/10 dark:hover:text-sky-300 dark:hover:ring-sky-700"
              aria-label={labels.postsInCategory(term.label)}
            >
              <span className="font-medium [overflow-wrap:anywhere]">{term.label}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-white/10 dark:text-white/60">
                {term.count}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {terms.map((term) => (
            <Link
              key={term.slug}
              href={localizePath(`${route}/${term.slug}`, locale)}
              data-term-chip
              className="inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-[8px] bg-white/64 px-2.5 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200/60 hover:bg-sky-50 hover:text-sky-700 hover:ring-sky-300 motion-safe:transition-[box-shadow,color,background-color] motion-safe:duration-200 motion-safe:ease-out dark:bg-white/[0.04] dark:text-white/68 dark:ring-white/8 dark:hover:bg-sky-900/24 dark:hover:text-sky-300 dark:hover:ring-sky-700"
              aria-label={labels.postsTagged(term.label)}
            >
              <span className="font-medium [overflow-wrap:anywhere]">#{term.label}</span>
              <span className="text-xs text-slate-400 dark:text-white/40">{term.count}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
