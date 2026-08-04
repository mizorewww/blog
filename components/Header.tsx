'use client'

import { useEffect, useRef, useState } from 'react'
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
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const pathname = usePathname()
  const labels = ui[getLocaleFromPathname(pathname)]
  const mobileNavigationButtonRef = useRef<HTMLButtonElement>(null)
  const headerShellRef = useRef<HTMLDivElement>(null)
  const shouldHide = hideOnMobile && isMobile && !mobileNavigationOpen

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const sync = () => {
      setIsMobile(media.matches)

      if (!media.matches) {
        setMobileNavigationOpen(false)
      }
    }

    sync()
    media.addEventListener('change', sync)

    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    setMobileNavigationOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileNavigationOpen) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setMobileNavigationOpen(false)
      mobileNavigationButtonRef.current?.focus()
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!headerShellRef.current?.contains(event.target as Node)) {
        setMobileNavigationOpen(false)
      }
    }

    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePointer)

    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }
  }, [mobileNavigationOpen])

  return (
    <SlideHeader
      hidden={shouldHide}
      className={`dark:bg-surface-card-dark/95 fixed inset-x-0 top-0 z-50 w-full bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur lg:translate-y-0 lg:opacity-100 dark:shadow-none ${
        shouldHide ? 'pointer-events-none lg:pointer-events-auto' : ''
      }`}
    >
      <div
        ref={headerShellRef}
        className="header-shell relative mx-auto flex w-full items-center justify-between gap-x-2 px-3 py-2 md:px-6 lg:flex-nowrap lg:gap-x-7 lg:px-0 lg:py-4"
      >
        <div data-header-logo className="z-10 shrink-0">
          <HeaderLogo />
        </div>
        <div className="ml-auto hidden min-w-0 text-xl leading-5 lg:block">
          <nav aria-label={labels.primaryNavigation}>
            <HeaderNavLinks />
          </nav>
        </div>
        <div
          data-header-controls
          className="z-10 flex shrink-0 items-center gap-x-1.5 text-slate-600 lg:gap-x-4 dark:text-white/90"
        >
          <Link
            href="/feed.xml"
            aria-label={labels.subscribeRss}
            className="hidden h-10 w-10 touch-manipulation items-center justify-center rounded-full hover:text-sky-700 lg:inline-flex dark:hover:text-sky-300"
          >
            <Icon name="Rss" className="h-6 w-6" inlineSpacing={false} />
          </Link>
          <div data-header-language-switcher>
            <LanguageSwitcher />
          </div>
          <ThemeSwitch />
          <button
            ref={mobileNavigationButtonRef}
            type="button"
            aria-label={mobileNavigationOpen ? labels.closeNavigation : labels.openNavigation}
            aria-expanded={mobileNavigationOpen}
            aria-controls="mobile-primary-navigation"
            className="inline-flex h-11 w-11 items-center justify-center text-slate-700 hover:text-sky-700 lg:hidden dark:text-white/90 dark:hover:text-sky-300"
            onClick={() => setMobileNavigationOpen((open) => !open)}
          >
            {mobileNavigationOpen ? (
              <Icon name="X" className="h-6 w-6" inlineSpacing={false} />
            ) : (
              <Icon name="Menu" className="h-6 w-6" inlineSpacing={false} />
            )}
          </button>
        </div>
        {mobileNavigationOpen && isMobile && (
          <div
            id="mobile-primary-navigation"
            className="dark:bg-surface-card-dark absolute inset-x-0 top-full border-t border-slate-200 bg-white shadow-sm lg:hidden dark:border-white/10"
          >
            <nav aria-label={labels.primaryNavigation}>
              <HeaderNavLinks variant="mobile" onNavigate={() => setMobileNavigationOpen(false)} />
            </nav>
          </div>
        )}
      </div>
    </SlideHeader>
  )
}

export default Header
