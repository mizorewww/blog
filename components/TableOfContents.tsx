'use client'

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import CollapsiblePanel from '@/components/animata/CollapsiblePanel'
import Link from '@/components/Link'
import { cardClass, mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'
import Icon from '@/components/Icon'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'

type Heading = { id: string; text: string; level: number }

const TOP_THRESHOLD = 120

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
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
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

      const headingEls = items
        .map((h) => document.getElementById(h.id))
        .filter((el): el is HTMLElement => el !== null)

      const updateActive = () => {
        let active = items[0].id
        for (const el of headingEls) {
          if (el.getBoundingClientRect().top <= TOP_THRESHOLD) {
            active = el.id
          }
        }
        setActiveId(active)
      }

      updateActive()
      window.addEventListener('scroll', updateActive, { passive: true })
      cleanup = () => window.removeEventListener('scroll', updateActive)
    })

    let cleanup: (() => void) | undefined

    return () => {
      cancelAnimationFrame(raf)
      cleanup?.()
    }
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
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: animataQuickDuration, ease: animataEase }
          }
        >
          <Icon
            name="ChevronDown"
            className={`h-4 w-4 ${mutedText}`}
            inlineSpacing={false}
            decorative
          />
        </motion.div>
      </button>
      <CollapsiblePanel id="toc-mobile" open={open} contentClassName="px-5 pb-4">
        <nav aria-label={labels.tableOfContents}>
          <ul className="space-y-0.5 border-l border-slate-200 text-sm dark:border-white/10">
            {headings.map((h) => (
              <li key={h.id} className={`relative ${h.level === 3 ? 'ml-3' : ''}`}>
                {activeId === h.id && (
                  <motion.div
                    layoutId="mobile-toc-active"
                    className="absolute top-0 bottom-0 -ml-px w-0.5 bg-sky-500 dark:bg-sky-400"
                    transition={
                      shouldReduceMotion
                        ? { duration: 0 }
                        : { duration: animataQuickDuration, ease: animataEase }
                    }
                  />
                )}
                <Link
                  href={`#${h.id}`}
                  onClick={() => setOpen(false)}
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
      </CollapsiblePanel>
    </div>
  )
}
