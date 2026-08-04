'use client'

import { useTheme } from 'next-themes'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { getLocaleFromPathname, ui } from '@/lib/i18n'
import { getLanguageLogo } from '@/lib/languageLogos'

const echartsLogo = getLanguageLogo('echarts')

type EChartsProps = {
  height?: number | string
  option: string | Record<string, unknown>
  title?: string
}

function toChartHeight(value: number | string) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return `${value}px`
  }

  return typeof value === 'number' ? `${value}px` : value
}

function parseChartOption(option: EChartsProps['option']): EChartsCoreOption | null {
  if (typeof option !== 'string') {
    return option as EChartsCoreOption
  }

  try {
    return JSON.parse(option) as EChartsCoreOption
  } catch {
    return null
  }
}

export default function ECharts({ height = 360, option, title }: EChartsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [failed, setFailed] = useState(false)
  const labels = ui[getLocaleFromPathname(usePathname())]
  const chartOption = useMemo(() => parseChartOption(option), [option])
  const theme = mounted && resolvedTheme === 'light' ? 'light' : 'dark'

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) {
      return
    }

    const container = containerRef.current

    if (!container || !chartOption) {
      setFailed(!chartOption)
      return
    }

    let chart: EChartsType | undefined
    let observer: ResizeObserver | undefined
    let cancelled = false

    import('@/lib/echartsCore')
      .then(({ default: echarts }) => {
        if (cancelled || !containerRef.current) {
          return
        }

        chart = echarts.init(containerRef.current, theme === 'dark' ? 'dark' : undefined, {
          renderer: 'canvas',
        })
        chart.setOption({ backgroundColor: 'transparent', ...chartOption })

        observer = new ResizeObserver(() => chart?.resize())
        observer.observe(containerRef.current)
      })
      .catch(() => setFailed(true))

    return () => {
      cancelled = true
      observer?.disconnect()
      chart?.dispose()
    }
  }, [mounted, theme, chartOption])

  return (
    <figure className="article-data-block not-prose dark:border-border-subtle-dark dark:bg-surface-code-dark my-7 overflow-hidden rounded-[10px] border border-slate-200/90 bg-white shadow-sm dark:shadow-none">
      <figcaption className="flex items-center gap-1.5 px-4 pt-2">
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center text-slate-400 dark:text-white/45"
          style={echartsLogo ? { color: `#${echartsLogo.hex}` } : undefined}
        >
          {echartsLogo ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path d={echartsLogo.path} />
            </svg>
          ) : (
            'EC'
          )}
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-slate-500 dark:text-white/50">
          {title || 'ECharts'}
        </span>
      </figcaption>
      {failed ? (
        <div
          className="flex items-center justify-center px-4 text-sm text-slate-500 dark:text-white/55"
          style={{ height: toChartHeight(height) }}
        >
          {labels.chartLoadError}
        </div>
      ) : (
        <div
          ref={containerRef}
          role="img"
          aria-label={title || 'ECharts'}
          className="w-full p-2 sm:p-3"
          style={{ height: toChartHeight(height) }}
        />
      )}
    </figure>
  )
}
