'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import SlideHeader from '@/components/animata/SlideHeader'
import HeaderLogo from './HeaderLogo'
import HeaderNavLinks from './HeaderNavLinks'
import ThemeSwitch from './ThemeSwitch'
import LanguageSwitcher from './LanguageSwitcher'
import Link from './Link'
import Icon from './Icon'
import { getLocaleFromPathname, ui } from '@/lib/i18n'

const Header = ({ hideOnMobile = false }: { hideOnMobile?: boolean }) => {
  const [isMobile, setIsMobile] = useState(false)
  const labels = ui[getLocaleFromPathname(usePathname())]
  const shouldHide = hideOnMobile && isMobile

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const sync = () => setIsMobile(media.matches)

    sync()
    media.addEventListener('change', sync)

    return () => media.removeEventListener('change', sync)
  }, [])

  return (
    <SlideHeader
      hidden={shouldHide}
      className={`dark:bg-surface-card-dark/95 fixed inset-x-0 top-0 z-50 w-full bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur sm:translate-y-0 sm:opacity-100 dark:shadow-none ${
        shouldHide ? 'pointer-events-none sm:pointer-events-auto' : ''
      }`}
    >
      <div className="header-shell relative mx-auto flex w-full items-center justify-between gap-x-3 px-3 py-2.5 sm:flex-nowrap sm:gap-x-7 sm:px-6 sm:py-4 lg:px-0">
        <div className="z-10 shrink-0">
          <HeaderLogo />
        </div>
        <div className="absolute top-1/2 left-1/2 max-w-[calc(100vw-224px)] min-w-0 -translate-x-1/2 -translate-y-1/2 text-sm leading-5 sm:static sm:ml-auto sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:text-lg lg:text-xl">
          <HeaderNavLinks />
        </div>
        <div className="z-10 flex shrink-0 items-center gap-x-3 text-slate-600 sm:gap-x-4 dark:text-white/90">
          <Link
            href="/feed.xml"
            aria-label={labels.subscribeRss}
            className="hidden hover:text-sky-700 sm:inline-flex dark:hover:text-sky-300"
          >
            <Icon name="Rss" className="h-6 w-6" inlineSpacing={false} />
          </Link>
          <LanguageSwitcher />
          <ThemeSwitch />
        </div>
      </div>
    </SlideHeader>
  )
}

export default Header
