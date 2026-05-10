'use client'

import { usePathname } from 'next/navigation'
import siteMetadata from '@/data/siteMetadata'
import Link from './Link'
import Image from './Image'
import { getLocaleFromPathname, localizePath } from '@/lib/i18n'

const HeaderLogo = () => {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)

  return (
    <Link href={localizePath('/', locale)} aria-label={siteMetadata.headerTitle}>
      <div className="flex items-center justify-between gap-3">
        <Image
          src="/static/images/avatar.png"
          width={40}
          height={40}
          alt=""
          className="rounded-full bg-white p-0.5"
        />
        {typeof siteMetadata.headerTitle === 'string' ? (
          <div className="text-xl font-semibold text-slate-900 sm:text-2xl dark:text-white/90">
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
