'use client'

import { usePathname } from 'next/navigation'
import { getLocaleFromPathname, localizePath } from '@/lib/i18n'
import Link from './Link'

const SearchButton = () => {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)

  return (
    <Link
      href={localizePath('/search', locale)}
      aria-label="搜索"
      className="transition hover:text-sky-500"
    >
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        className="h-6 w-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 105.2 5.2a7.5 7.5 0 0010.6 10.6z"
        />
      </svg>
    </Link>
  )
}

export default SearchButton
