'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import Footer from './Footer'
import Header from './Header'
import { stripLocaleFromPathname } from '@/lib/i18n'

const BLOG_PATH_CHANGE_EVENT = 'blog-pathchange'

function isBlogPostPath(pathname: string) {
  const strippedPath = stripLocaleFromPathname(pathname).replace(/\/+$/, '')

  return /^\/blog\/[^/]+/.test(strippedPath)
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [currentPathname, setCurrentPathname] = useState(pathname)
  const isReadingPost = isBlogPostPath(currentPathname)

  useEffect(() => {
    setCurrentPathname(pathname)
  }, [pathname])

  useEffect(() => {
    const syncPathname = () => setCurrentPathname(window.location.pathname)

    window.addEventListener('popstate', syncPathname)
    window.addEventListener(BLOG_PATH_CHANGE_EVENT, syncPathname)

    return () => {
      window.removeEventListener('popstate', syncPathname)
      window.removeEventListener(BLOG_PATH_CHANGE_EVENT, syncPathname)
    }
  }, [])

  return (
    <div className="flex min-h-screen flex-col">
      <Header hideOnMobile={isReadingPost} />
      <main
        className={`flex-1 transition-[padding-top] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          isReadingPost ? 'pt-0 sm:pt-[96px]' : 'pt-[72px] sm:pt-[96px]'
        }`}
      >
        {children}
      </main>
      <Footer />
    </div>
  )
}
