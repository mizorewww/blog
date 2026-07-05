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
    <div className="blog-shell mx-auto w-full px-4 pt-10 pb-16 sm:px-6">
      <h1 className="mb-8 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl dark:text-white/90">
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
              className="dark:bg-surface-card-dark inline-flex items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-slate-700 ring-1 ring-slate-200/70 transition-all duration-200 hover:text-sky-700 hover:ring-sky-400 dark:text-white/80 dark:ring-white/10 dark:hover:text-sky-300 dark:hover:ring-sky-700"
              aria-label={labels.postsInCategory(term.label)}
            >
              <span className="font-medium">{term.label}</span>
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
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600 transition-all duration-200 hover:bg-sky-100 hover:text-sky-700 dark:bg-white/10 dark:text-white/70 dark:hover:bg-sky-900/30 dark:hover:text-sky-300"
              aria-label={labels.postsTagged(term.label)}
            >
              <span className="font-medium">#{term.label}</span>
              <span className="text-xs text-slate-400 dark:text-white/40">{term.count}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
