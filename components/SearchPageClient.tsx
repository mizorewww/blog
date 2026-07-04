'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from '@/components/Link'
import Icon from '@/components/Icon'
import { cardClass, mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'

type SearchResult = {
  url: string
  excerpt: string
  meta: { title: string; image?: string }
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'loading'; query: string }
  | { phase: 'results'; query: string; results: SearchResult[] }
  | { phase: 'empty'; query: string }

const PAGEFIND_PATH = '/pagefind/pagefind.js'
const RESULT_LIMIT = 10

export default function SearchPageClient({ locale }: { locale: Locale }) {
  const labels = ui[locale]
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ phase: 'idle' })
  const pagefindRef = useRef<{
    init: () => void
    debouncedSearch: (
      q: string,
      opts?: unknown,
      timeout?: number
    ) => Promise<{ results: Array<{ data: () => Promise<SearchResult> }> } | null>
    preload: (q: string) => void
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false

    import(PAGEFIND_PATH)
      .then((mod: unknown) => {
        if (cancelled) return
        const pf = mod as {
          init: () => void
          search: (q: string) => Promise<{ results: Array<{ data: () => Promise<SearchResult> }> }>
          debouncedSearch: (
            q: string,
            opts?: unknown,
            timeout?: number
          ) => Promise<{ results: Array<{ data: () => Promise<SearchResult> }> } | null>
          preload: (q: string) => void
          destroy: () => Promise<void>
        }
        pf.init()
        pagefindRef.current = pf
      })
      .catch(() => {
        // pagefind.js may not be available in dev mode (only built after next build)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const performSearch = useCallback(async (searchQuery: string) => {
    const pf = pagefindRef.current
    if (!pf || !searchQuery.trim()) {
      setState({ phase: 'idle' })
      return
    }

    setState({ phase: 'loading', query: searchQuery })

    try {
      const search = await pf.debouncedSearch(searchQuery, {}, 250)
      if (!search) return // superseded by a newer search

      const results = await Promise.all(search.results.slice(0, RESULT_LIMIT).map((r) => r.data()))

      if (results.length === 0) {
        setState({ phase: 'empty', query: searchQuery })
      } else {
        setState({ phase: 'results', query: searchQuery, results })
      }
    } catch {
      setState({ phase: 'empty', query: searchQuery })
    }
  }, [])

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setQuery(value)
      pagefindRef.current?.preload(value)
      performSearch(value)
    },
    [performSearch]
  )

  return (
    <div className="blog-shell mx-auto w-full px-4 py-10 sm:px-0">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white/90">
        {labels.search}
      </h1>

      {/* Search input */}
      <div className={`relative mb-6 ${cardClass} flex items-center gap-3 px-5 py-4`}>
        <Icon
          name="Search"
          className="h-5 w-5 shrink-0 text-slate-400 dark:text-white/40"
          inlineSpacing={false}
          decorative
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={onInput}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.search}
          className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-white/90 dark:placeholder:text-white/40"
        />
      </div>

      {/* States */}
      {state.phase === 'idle' && <p className={`px-1 text-sm ${mutedText}`}>{labels.searchHint}</p>}

      {state.phase === 'loading' && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${cardClass} animate-pulse px-5 py-4`}>
              <div className="mb-2 h-5 w-2/3 rounded bg-slate-200 dark:bg-white/10" />
              <div className="h-4 w-full rounded bg-slate-100 dark:bg-white/5" />
            </div>
          ))}
        </div>
      )}

      {state.phase === 'empty' && (
        <p className={`px-1 text-sm ${mutedText}`}>{labels.searchNoResults(state.query)}</p>
      )}

      {state.phase === 'results' && (
        <div className="space-y-3">
          <p className={`mb-2 px-1 text-sm ${mutedText}`}>
            {labels.searchResultCount(state.results.length, state.query)}
          </p>
          {state.results.map((result) => (
            <Link
              key={result.url}
              href={result.url}
              className={`${cardClass} block px-5 py-4 transition-shadow hover:shadow-[0_18px_44px_rgba(21,30,43,0.1)] dark:hover:shadow-none`}
            >
              <h2 className="mb-1.5 text-lg font-medium text-slate-900 dark:text-white/90">
                {result.meta?.title || result.url}
              </h2>
              {result.excerpt && (
                <p
                  className="text-sm leading-6 text-slate-600 dark:text-white/70 [&_mark]:rounded [&_mark]:bg-sky-100 [&_mark]:px-0.5 [&_mark]:text-sky-700 dark:[&_mark]:bg-sky-900/40 dark:[&_mark]:text-sky-300"
                  dangerouslySetInnerHTML={{ __html: result.excerpt }}
                />
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
