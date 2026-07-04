'use client'

import { useEffect, useState } from 'react'
import BlogWidgetCard from '@/components/BlogWidgetCard'
import Link from '@/components/Link'
import { type Locale, ui } from '@/lib/i18n'

type Heading = { id: string; text: string; level: number }

export default function SidebarTOC({
  expandedPath,
  locale,
}: {
  expandedPath: string | null
  locale: Locale
}) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState('')
  const labels = ui[locale]

  useEffect(() => {
    if (!expandedPath) {
      setHeadings([])
      setActiveId('')
      return
    }

    // The expanded article is the only rendered card; query its prose headings.
    const article = document.querySelector<HTMLElement>(
      `[data-post-path="${CSS.escape(expandedPath)}"]`
    )
    if (!article) {
      setHeadings([])
      return
    }

    const elements = article.querySelectorAll<HTMLElement>('.prose h2, .prose h3')
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
  }, [expandedPath])

  if (!expandedPath || headings.length < 2) return null

  return (
    <BlogWidgetCard title={labels.tableOfContents}>
      <nav aria-label={labels.tableOfContents}>
        <ul className="space-y-1 text-sm">
          {headings.map((h) => (
            <li key={h.id} className={h.level === 3 ? 'ml-3' : ''}>
              <Link
                href={`#${h.id}`}
                className={`block border-l-2 py-1 pl-3 transition-colors ${
                  activeId === h.id
                    ? 'border-sky-500 font-medium text-sky-700 dark:border-sky-400 dark:text-sky-300'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-sky-700 dark:border-white/10 dark:text-white/70 dark:hover:text-sky-300'
                }`}
              >
                <span className="block truncate">{h.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </BlogWidgetCard>
  )
}
