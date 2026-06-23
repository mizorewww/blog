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
    <div className="flex items-center rounded-md border border-gray-200 text-sm font-medium dark:border-gray-700">
      {locales.map((locale) => {
        const isActive = locale === currentLocale

        return (
          <Link
            key={locale}
            href={getLanguageHref(pathname, locale)}
            aria-current={isActive ? 'page' : undefined}
            className={`px-2 py-1 ${
              isActive
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : 'hover:text-primary-500 dark:hover:text-primary-400 text-gray-600 dark:text-gray-300'
            }`}
          >
            {localeConfig[locale].label}
          </Link>
        )
      })}
    </div>
  )
}

export default LanguageSwitcher
