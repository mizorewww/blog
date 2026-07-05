'use client'

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import BlogWidgetCard from '@/components/BlogWidgetCard'
import Link from '@/components/Link'
import { type Locale, ui } from '@/lib/i18n'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'

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
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    if (!expandedPath) {
      setHeadings([])
      setActiveId('')
      return
    }

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

  const indicatorTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: animataQuickDuration, ease: animataEase }

  return (
    <BlogWidgetCard title={labels.tableOfContents}>
      <nav aria-label={labels.tableOfContents}>
        <ul className="space-y-0.5 text-sm">
          {headings.map((h) => (
            <li key={h.id} className={`relative ${h.level === 3 ? 'ml-3' : ''}`}>
              {activeId === h.id && (
                <motion.div
                  layoutId="sidebar-toc-active"
                  className="absolute top-0 bottom-0 left-0 w-0.5 bg-sky-500 dark:bg-sky-400"
                  transition={indicatorTransition}
                />
              )}
              <Link
                href={`#${h.id}`}
                className={`block py-1 pl-3 transition-colors duration-200 ${
                  activeId === h.id
                    ? 'font-medium text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-sky-700 dark:text-white/70 dark:hover:text-sky-300'
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
