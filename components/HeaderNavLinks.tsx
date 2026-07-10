'use client'

import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'motion/react'
import headerNavLinks from '@/data/headerNavLinks'
import Link from './Link'
import { getLocaleFromPathname, localizePath, ui } from '@/lib/i18n'
import { normalizePathname } from '@/lib/blogRouteState'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'

const HeaderNavLinks = ({
  variant = 'desktop',
  onNavigate,
}: {
  variant?: 'desktop' | 'mobile'
  onNavigate?: () => void
}) => {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)
  const labels = ui[locale]
  const shouldReduceMotion = useReducedMotion()
  const isMobile = variant === 'mobile'

  return (
    <div
      className={
        isMobile
          ? 'flex flex-col text-base text-slate-700 dark:text-white/90'
          : 'no-scrollbar flex max-w-full items-center justify-start gap-x-7 overflow-x-auto text-slate-700 dark:text-white/90'
      }
    >
      {headerNavLinks.map((link) => {
        const isExternal = link.href.startsWith('http')
        const href = isExternal ? link.href : localizePath(link.href, locale)
        const currentPath = normalizePathname(pathname)
        const targetPath = normalizePathname(href)
        const active =
          !isExternal &&
          (currentPath === targetPath ||
            (link.href !== '/' && currentPath.startsWith(`${targetPath}/`)))

        return (
          <Link
            key={link.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={`relative font-medium transition-colors duration-200 hover:text-sky-700 dark:hover:text-sky-300 ${
              isMobile ? 'min-h-11 px-4 py-3' : ''
            } ${
              active
                ? isMobile
                  ? 'bg-slate-100 text-sky-700 dark:bg-white/5 dark:text-sky-400'
                  : 'text-sky-700 dark:text-sky-400'
                : ''
            }`}
          >
            {labels[link.key]}
            {active && !isMobile && (
              <motion.div
                layoutId="nav-active-underline"
                data-animata-nav-active-underline
                className="absolute right-0 -bottom-1.5 left-0 h-0.5 rounded-full bg-sky-700 dark:bg-sky-400"
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { duration: animataQuickDuration, ease: animataEase }
                }
              />
            )}
          </Link>
        )
      })}
    </div>
  )
}

export default HeaderNavLinks
