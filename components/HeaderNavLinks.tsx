'use client'

import { usePathname } from 'next/navigation'
import headerNavLinks from '@/data/headerNavLinks'
import Link from './Link'
import { getLocaleFromPathname, localizePath, ui } from '@/lib/i18n'

const HeaderNavLinks = () => {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)
  const labels = ui[locale]

  return (
    <div className="no-scrollbar hidden max-w-40 items-center gap-x-4 overflow-x-auto sm:flex md:max-w-72 lg:max-w-96">
      {headerNavLinks
        .filter((link) => link.href !== '/')
        .map((link) => (
          <Link
            key={link.key}
            href={localizePath(link.href, locale)}
            className="hover:text-primary-500 dark:hover:text-primary-400 m-1 font-medium text-gray-900 dark:text-gray-100"
          >
            {labels[link.key]}
          </Link>
        ))}
    </div>
  )
}

export default HeaderNavLinks
