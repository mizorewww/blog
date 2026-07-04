'use client'

import { useEffect, useState } from 'react'
import CollapsiblePanel from '@/components/animata/CollapsiblePanel'
import Link from '@/components/Link'
import { cardClass, mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'
import Icon from '@/components/Icon'

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
  const [open, setOpen] = useState(false)
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
    <div className={`not-prose mb-6 ${cardClass} overflow-hidden lg:hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-white/80">
          <Icon name="ScrollText" className="h-4 w-4" inlineSpacing={false} decorative />
          {labels.tableOfContents}
        </span>
        <Icon
          name={open ? 'ChevronUp' : 'ChevronDown'}
          className={`h-4 w-4 transition-transform ${mutedText}`}
          inlineSpacing={false}
          decorative
        />
      </button>
      <CollapsiblePanel id="toc-mobile" open={open} contentClassName="px-5 pb-4">
        <nav aria-label={labels.tableOfContents}>
          <ul className="space-y-1 border-l border-slate-200 text-sm dark:border-white/10">
            {headings.map((h) => (
              <li key={h.id} className={h.level === 3 ? 'ml-3' : ''}>
                <Link
                  href={`#${h.id}`}
                  onClick={() => setOpen(false)}
                  className={`-ml-px block border-l-2 py-1 pl-3 transition-colors ${
                    activeId === h.id
                      ? 'border-sky-500 font-medium text-sky-700 dark:border-sky-400 dark:text-sky-300'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-sky-700 dark:text-white/70 dark:hover:text-sky-300'
                  }`}
                >
                  <span className="block truncate">{h.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </CollapsiblePanel>
    </div>
  )
}
