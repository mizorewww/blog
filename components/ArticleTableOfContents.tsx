'use client'

import { useEffect, useId, useState } from 'react'
import CollapsiblePanel from '@/components/animata/CollapsiblePanel'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import { type Locale, ui } from '@/lib/i18n'
import type { TocHeading } from '@/lib/toc'

const TOP_THRESHOLD = 120

function headingId(heading: TocHeading) {
  return heading.url.slice(1)
}

function TocLinks({
  activeId,
  headings,
  onNavigate,
}: {
  activeId: string
  headings: TocHeading[]
  onNavigate?: (id: string) => void
}) {
  return (
    <ul className="space-y-0.5 text-sm">
      {headings.map((heading) => {
        const id = headingId(heading)
        const active = activeId === id

        return (
          <li key={`${heading.depth}:${heading.url}`} className={heading.depth === 3 ? 'ml-3' : ''}>
            <Link
              href={heading.url}
              aria-current={active ? 'location' : undefined}
              onClick={() => onNavigate?.(id)}
              className={`block border-l-2 py-1.5 pl-3 transition-colors duration-200 ${
                active
                  ? 'border-sky-500 font-medium text-sky-700 dark:border-sky-400 dark:text-sky-300'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-sky-700 dark:border-white/10 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-sky-300'
              }`}
            >
              <span className="block truncate">{heading.value}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export default function ArticleTableOfContents({
  headings,
  locale,
  variant,
}: {
  headings: TocHeading[]
  locale: Locale
  variant: 'mobile' | 'desktop'
}) {
  const [activeId, setActiveId] = useState(() => (headings[0] ? headingId(headings[0]) : ''))
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const labels = ui[locale]

  useEffect(() => {
    const headingElements = headings
      .map((heading) => document.getElementById(headingId(heading)))
      .filter((element): element is HTMLElement => element !== null)

    if (headingElements.length === 0) {
      return
    }

    let frame = 0
    const updateActive = () => {
      frame = 0
      let nextActive = headingElements[0].id

      for (const element of headingElements) {
        if (element.getBoundingClientRect().top <= TOP_THRESHOLD) {
          nextActive = element.id
        }
      }

      setActiveId((current) => (current === nextActive ? current : nextActive))
    }
    const onScroll = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(updateActive)
      }
    }

    updateActive()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [headings])

  if (headings.length === 0) {
    return null
  }

  if (variant === 'mobile') {
    return (
      <section className="article-toc-mobile dark:border-border-subtle-dark w-full overflow-hidden border-y border-slate-200 xl:hidden">
        <button
          type="button"
          aria-controls={panelId}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center justify-between px-5 py-3 text-left sm:px-8 lg:px-10"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-white/80">
            <Icon name="ScrollText" className="h-4 w-4" inlineSpacing={false} decorative />
            {labels.tableOfContents}
          </span>
          <Icon
            name="ChevronDown"
            className={`h-4 w-4 text-slate-500 transition-transform duration-200 motion-reduce:transition-none dark:text-white/60 ${open ? 'rotate-180' : ''}`}
            inlineSpacing={false}
            decorative
          />
        </button>
        <CollapsiblePanel id={panelId} open={open} contentClassName="px-5 pb-4 sm:px-8 lg:px-10">
          <nav aria-label={labels.tableOfContents}>
            <TocLinks
              activeId={activeId}
              headings={headings}
              onNavigate={(id) => {
                setActiveId(id)
                setOpen(false)
              }}
            />
          </nav>
        </CollapsiblePanel>
      </section>
    )
  }

  return (
    <aside className="article-toc-desktop hidden xl:block">
      <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-white/85">
        {labels.tableOfContents}
      </h2>
      <nav aria-label={labels.tableOfContents}>
        <TocLinks activeId={activeId} headings={headings} onNavigate={setActiveId} />
      </nav>
    </aside>
  )
}
