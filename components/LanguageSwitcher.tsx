'use client'

import { usePathname } from 'next/navigation'
import Link from './Link'
import {
  getLocaleFromPathname,
  localeConfig,
  locales,
  switchLocalePathForSection,
  type Locale,
} from '@/lib/i18n'

function getLanguageHref(pathname: string, locale: Locale) {
  return switchLocalePathForSection(pathname, locale)
}

const LanguageSwitcher = () => {
  const pathname = usePathname()
  const currentLocale = getLocaleFromPathname(pathname)

  return (
    <div className="flex items-center rounded-md border border-slate-200 p-0.5 text-sm font-medium dark:border-white/10">
      {locales.map((locale) => {
        const isActive = locale === currentLocale

        return (
          <Link
            key={locale}
            href={getLanguageHref(pathname, locale)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative isolate overflow-hidden rounded px-2 py-1 ${
              isActive
                ? 'text-white dark:text-slate-900'
                : 'text-slate-600 hover:text-sky-700 dark:text-white/80 dark:hover:text-sky-300'
            }`}
          >
            {isActive && (
              <span
                aria-hidden="true"
                data-animata-language-switcher-active
                className="pointer-events-none absolute inset-0 -z-10 rounded bg-slate-900 dark:bg-slate-100"
              />
            )}
            <span className="relative">{localeConfig[locale].label}</span>
          </Link>
        )
      })}
    </div>
  )
}

export default LanguageSwitcher
