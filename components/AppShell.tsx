'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Footer from './Footer'
import Header from './Header'
import PageTransition from './animata/PageTransition'
import { isBlogPostPath } from '@/lib/blogRouteState'
import { getLocaleFromPathname, ui } from '@/lib/i18n'

const HEADER_HIDE_SCROLL_Y = 80
const SCROLL_DELTA_THRESHOLD = 6

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [currentPathname, setCurrentPathname] = useState(pathname)
  const [hideHeaderOnMobile, setHideHeaderOnMobile] = useState(false)
  const previousScrollYRef = useRef(0)
  const isReadingPost = isBlogPostPath(currentPathname)

  useEffect(() => {
    setCurrentPathname(pathname)
  }, [pathname])

  useEffect(() => {
    previousScrollYRef.current = window.scrollY
    setHideHeaderOnMobile(false)

    if (!isReadingPost) {
      return
    }

    const syncHeaderVisibility = () => {
      const currentScrollY = window.scrollY
      const scrollDelta = currentScrollY - previousScrollYRef.current

      if (currentScrollY <= SCROLL_DELTA_THRESHOLD) {
        setHideHeaderOnMobile(false)
      } else if (scrollDelta > SCROLL_DELTA_THRESHOLD && currentScrollY > HEADER_HIDE_SCROLL_Y) {
        setHideHeaderOnMobile(true)
      } else if (scrollDelta < -SCROLL_DELTA_THRESHOLD) {
        setHideHeaderOnMobile(false)
      }

      previousScrollYRef.current = currentScrollY
    }

    window.addEventListener('scroll', syncHeaderVisibility, { passive: true })

    return () => window.removeEventListener('scroll', syncHeaderVisibility)
  }, [isReadingPost])

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:rounded focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white"
      >
        {ui[getLocaleFromPathname(pathname)].skipToContent}
      </a>
      <Header hideOnMobile={isReadingPost && hideHeaderOnMobile} />
      <main id="main-content" tabIndex={-1} className="flex-1 pt-[72px] sm:pt-[96px]">
        <PageTransition pathname={pathname}>{children}</PageTransition>
      </main>
      <Footer />
    </div>
  )
}
