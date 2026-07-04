'use client'

import { usePathname } from 'next/navigation'
import headerNavLinks from '@/data/headerNavLinks'
import Link from './Link'
import { getLocaleFromPathname, localizePath, ui } from '@/lib/i18n'
import { normalizePathname } from '@/lib/blogRouteState'

const HeaderNavLinks = () => {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)
  const labels = ui[locale]

  return (
    <div className="no-scrollbar flex max-w-full items-center justify-center gap-x-3 overflow-x-auto text-slate-700 sm:justify-start sm:gap-x-7 dark:text-white/90">
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
            className={`font-medium hover:text-sky-700 dark:hover:text-sky-300 ${active ? 'text-sky-700 underline decoration-2 underline-offset-4 dark:text-sky-400' : ''}`}
          >
            {labels[link.key]}
          </Link>
        )
      })}
    </div>
  )
}

export default HeaderNavLinks
