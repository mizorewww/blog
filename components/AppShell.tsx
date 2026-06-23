'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Footer from './Footer'
import Header from './Header'
import { isBlogPostPath } from '@/lib/blogRouteState'

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
      <Header hideOnMobile={isReadingPost && hideHeaderOnMobile} />
      <main className="flex-1 pt-[72px] sm:pt-[96px]">{children}</main>
      <Footer />
    </div>
  )
}
