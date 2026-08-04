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
    <Link
      href={localizePath('/', locale)}
      aria-label={siteMetadata.headerTitle}
      className="inline-flex min-h-11 min-w-11 touch-manipulation items-center rounded-full sm:rounded-[8px]"
    >
      <div className="flex items-center justify-between gap-3">
        <Image
          src="/static/images/avatar.png"
          width={36}
          height={36}
          alt=""
          className="rounded-full bg-white p-0.5 sm:h-10 sm:w-10"
        />
        {typeof siteMetadata.headerTitle === 'string' ? (
          <div className="hidden text-xl font-semibold text-slate-900 lg:block lg:text-2xl dark:text-white/90">
            {siteMetadata.headerTitle}
          </div>
        ) : (
          <div className="hidden lg:block">{siteMetadata.headerTitle}</div>
        )}
      </div>
    </Link>
  )
}

export default HeaderLogo
