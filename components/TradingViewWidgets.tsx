'use client'

import { normalizeTradingViewSymbol } from '@/lib/tradingview'
import { useEffect, useMemo, useRef, useState } from 'react'

type TradingViewTheme = 'light' | 'dark'

type TradingViewMiniChartProps = {
  dateRange?: string
  height?: number | string
  locale?: string
  symbol: string
}

type TradingViewAdvancedChartProps = {
  height?: number | string
  interval?: string
  locale?: string
  symbol: string
  timezone?: string
}

type TradingViewWidgetProps = {
  config: Record<string, string | number | boolean>
  height: number | string
  scriptSrc: string
  symbol: string
  title: string
  type: 'mini' | 'advanced'
}

const miniChartScript =
  'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js'
const advancedChartScript =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'

function getCurrentTheme(): TradingViewTheme {
  if (typeof document === 'undefined') {
    return 'dark'
  }

  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function useTradingViewTheme() {
  const [theme, setTheme] = useState<TradingViewTheme>('dark')

  useEffect(() => {
    const updateTheme = () => setTheme(getCurrentTheme())
    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, {
      attributeFilter: ['class'],
      attributes: true,
    })

    return () => observer.disconnect()
  }, [])

  return theme
}

function toWidgetHeight(value: number | string) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return `${value}px`
  }

  return typeof value === 'number' ? `${value}px` : value
}

function TradingViewWidget({
  config,
  height,
  scriptSrc,
  symbol,
  title,
  type,
}: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sourceUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    container.innerHTML = '<div class="tradingview-widget-container__widget"></div>'

    const script = document.createElement('script')
    script.async = true
    script.src = scriptSrc
    script.text = JSON.stringify(config)
    container.appendChild(script)

    return () => {
      container.innerHTML = ''
    }
  }, [config, scriptSrc])

  return (
    <figure className="not-prose my-7 overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-sm dark:border-[#405064] dark:bg-[#10161f]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-2 text-xs text-slate-600 dark:border-[#405064] dark:bg-white/[0.035] dark:text-white/65">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-emerald-200 bg-emerald-50 font-mono text-[0.68rem] font-semibold text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200"
          >
            $
          </span>
          <span className="min-w-0 truncate font-mono">{title}</span>
        </span>
        <a
          href={sourceUrl}
          rel="noopener noreferrer"
          target="_blank"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-900 dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white/90"
        >
          TradingView
        </a>
      </figcaption>
      <div
        className={type === 'advanced' ? 'h-[520px] w-full' : 'h-[220px] w-full'}
        style={{ height: toWidgetHeight(height) }}
      >
        <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
      </div>
    </figure>
  )
}

export function TradingViewMiniChart({
  dateRange = '12M',
  height = 220,
  locale = 'zh_CN',
  symbol,
}: TradingViewMiniChartProps) {
  const theme = useTradingViewTheme()
  const normalizedSymbol = normalizeTradingViewSymbol(symbol)
  const config = useMemo(
    () => ({
      autosize: true,
      colorTheme: theme,
      dateRange,
      height: '100%',
      isTransparent: true,
      largeChartUrl: '',
      locale,
      symbol: normalizedSymbol,
      trendLineColor: theme === 'dark' ? 'rgba(56, 189, 248, 1)' : 'rgba(2, 132, 199, 1)',
      underLineBottomColor: 'rgba(56, 189, 248, 0)',
      underLineColor: theme === 'dark' ? 'rgba(56, 189, 248, 0.16)' : 'rgba(2, 132, 199, 0.1)',
      width: '100%',
    }),
    [dateRange, locale, normalizedSymbol, theme]
  )

  return (
    <TradingViewWidget
      config={config}
      height={height}
      scriptSrc={miniChartScript}
      symbol={normalizedSymbol}
      title={`${normalizedSymbol} mini chart`}
      type="mini"
    />
  )
}

export function TradingViewAdvancedChart({
  height = 520,
  interval = 'D',
  locale = 'zh_CN',
  symbol,
  timezone = 'Asia/Shanghai',
}: TradingViewAdvancedChartProps) {
  const theme = useTradingViewTheme()
  const normalizedSymbol = normalizeTradingViewSymbol(symbol)
  const config = useMemo(
    () => ({
      allow_symbol_change: true,
      autosize: true,
      calendar: false,
      enable_publishing: false,
      height: '100%',
      hide_top_toolbar: false,
      interval,
      locale,
      save_image: false,
      style: '1',
      support_host: 'https://www.tradingview.com',
      symbol: normalizedSymbol,
      theme,
      timezone,
      width: '100%',
    }),
    [interval, locale, normalizedSymbol, theme, timezone]
  )

  return (
    <TradingViewWidget
      config={config}
      height={height}
      scriptSrc={advancedChartScript}
      symbol={normalizedSymbol}
      title={`${normalizedSymbol} advanced chart`}
      type="advanced"
    />
  )
}
