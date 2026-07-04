'use client'

import { useEffect, useState } from 'react'
import { type Locale, ui } from '@/lib/i18n'

type Heading = { id: string; text: string; level: number }

export default function TableOfContents({
  containerRef,
  locale,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  locale: Locale
}) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState('')
  const labels = ui[locale]

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const elements = container.querySelectorAll<HTMLElement>('.prose h2, .prose h3')
    const items: Heading[] = Array.from(elements)
      .map((el) => ({
        id: el.id,
        text: el.textContent || '',
        level: el.tagName === 'H2' ? 2 : 3,
      }))
      .filter((h) => h.id && h.text)

    setHeadings(items)
    if (items.length < 2) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px' }
    )

    for (const h of items) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [containerRef])

  if (headings.length < 2) return null

  return (
    <nav
      aria-label={labels.tableOfContents}
      className="not-prose dark:border-border-subtle-dark mb-6 rounded-[10px] border border-slate-200 p-4"
    >
      <h2 className="mb-3 text-sm font-medium text-slate-500 dark:text-white/60">
        {labels.tableOfContents}
      </h2>
      <ul className="space-y-1.5 text-sm">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? 'ml-4' : ''}>
            <a
              href={`#${h.id}`}
              className={`block truncate transition-colors ${
                activeId === h.id
                  ? 'text-sky-700 dark:text-sky-300'
                  : 'text-slate-600 hover:text-sky-700 dark:text-white/70 dark:hover:text-sky-300'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
