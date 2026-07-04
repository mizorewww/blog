'use client'

import { useEffect, useRef } from 'react'
import { ui, type Locale } from '@/lib/i18n'

export default function SearchPageClient({ locale }: { locale: Locale }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const labels = ui[locale]

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/pagefind/pagefind-component-ui.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.type = 'module'
    script.src = '/pagefind/pagefind-component-ui.js'
    document.head.appendChild(script)

    const initSearchbox = () => {
      if (!containerRef.current || containerRef.current.dataset.pagefindReady) return
      containerRef.current.dataset.pagefindReady = 'true'

      const searchbox = document.createElement('pagefind-searchbox')
      searchbox.setAttribute('id', 'pagefind-search')
      searchbox.setAttribute('data-placeholder', labels.searchPlaceholder)
      containerRef.current.appendChild(searchbox)
    }

    script.addEventListener('load', initSearchbox)

    return () => {
      link.remove()
      script.removeEventListener('load', initSearchbox)
      script.remove()
      loadedRef.current = false
    }
  }, [labels.searchPlaceholder])

  return (
    <div className="blog-shell mx-auto w-full px-4 py-10 sm:px-0">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white/90">
        {labels.search}
      </h1>
      <div ref={containerRef} className="search-pagefind-container" />
    </div>
  )
}
