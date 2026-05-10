'use client'

import { usePathname } from 'next/navigation'
import siteMetadata from '@/data/siteMetadata'
import Logo from '@/data/logo.svg'
import Link from './Link'
import { getLocaleFromPathname, localizePath } from '@/lib/i18n'

const HeaderLogo = () => {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)

  return (
    <Link href={localizePath('/', locale)} aria-label={siteMetadata.headerTitle}>
      <div className="flex items-center justify-between">
        <div className="mr-3">
          <Logo />
        </div>
        {typeof siteMetadata.headerTitle === 'string' ? (
          <div className="hidden h-6 text-2xl font-semibold sm:block">
            {siteMetadata.headerTitle}
          </div>
        ) : (
          siteMetadata.headerTitle
        )}
      </div>
    </Link>
  )
}

export default HeaderLogo
