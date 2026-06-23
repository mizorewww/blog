'use client'

import { motion, useReducedMotion } from 'motion/react'
import { usePathname } from 'next/navigation'
import Link from './Link'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'
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
  const shouldReduceMotion = useReducedMotion()

  return (
    <div className="flex items-center rounded-md border border-gray-200 p-0.5 text-sm font-medium dark:border-gray-700">
      {locales.map((locale) => {
        const isActive = locale === currentLocale

        return (
          <Link
            key={locale}
            href={getLanguageHref(pathname, locale)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative isolate rounded px-2 py-1 ${
              isActive
                ? 'text-white dark:text-gray-900'
                : 'hover:text-primary-500 dark:hover:text-primary-400 text-gray-600 dark:text-gray-300'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId="animata-language-switcher-active"
                data-animata-language-switcher-active
                className="absolute inset-0 -z-10 rounded bg-gray-900 dark:bg-gray-100"
                transition={{
                  duration: shouldReduceMotion ? 0 : animataQuickDuration,
                  ease: animataEase,
                }}
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
