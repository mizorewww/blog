'use client'

import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Toaster } from 'sonner'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import BlogListNavigationRecorder from './BlogListNavigationRecorder'
import Footer from './Footer'
import Header from './Header'
import ArticleRouteSkeleton from './animata/ArticleRouteSkeleton'
import { isBlogPostPath } from '@/lib/blogRouteState'
import { getLocaleFromPathname, ui } from '@/lib/i18n'

const HEADER_HIDE_SCROLL_Y = 80
const SCROLL_DELTA_THRESHOLD = 6

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [articleNavigationPending, setArticleNavigationPending] = useState(false)
  const [hideHeaderOnMobile, setHideHeaderOnMobile] = useState(false)
  const previousScrollYRef = useRef(0)
  const isReadingPost = isBlogPostPath(pathname)
  const { resolvedTheme } = useTheme()

  const showArticleNavigationFallback = useCallback(() => {
    setArticleNavigationPending(true)
  }, [])

  useEffect(() => {
    setArticleNavigationPending(false)
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
      <BlogListNavigationRecorder onArticleNavigation={showArticleNavigationFallback} />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:rounded focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white"
      >
        {ui[getLocaleFromPathname(pathname)].skipToContent}
      </a>
      <Header hideOnMobile={isReadingPost && hideHeaderOnMobile} />
      {articleNavigationPending && (
        <div className="dark:bg-surface-page-dark bg-surface-page pointer-events-none fixed inset-x-0 top-[72px] bottom-0 z-40 overflow-hidden sm:top-[96px]">
          <ArticleRouteSkeleton />
        </div>
      )}
      <main id="main-content" tabIndex={-1} className="flex-1 pt-[72px] sm:pt-[96px]">
        {children}
      </main>
      <Footer />
      <Toaster
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        position="bottom-right"
        richColors
      />
    </div>
  )
}
