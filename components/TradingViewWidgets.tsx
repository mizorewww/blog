'use client'

import { normalizeTradingViewSymbol } from '@/lib/tradingview'
import { useTheme } from 'next-themes'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { getLocaleFromPathname, localeConfig } from '@/lib/i18n'

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
  scriptSrc: string
}

type TradingViewWidgetFrameProps = {
  children: ReactNode
  height: number | string
  theme: TradingViewTheme
}

const miniChartScript =
  'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js'
const advancedChartScript =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
const tradingViewDarkBackground = 'rgb(16 22 31)'
const DEFAULT_TRADINGVIEW_TIMEZONE = 'Asia/Shanghai'

function useTradingViewLocale() {
  const pathname = usePathname()
  const locale = getLocaleFromPathname(pathname)

  return localeConfig[locale].htmlLang.replace('-', '_')
}

function useTradingViewTheme() {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme } = useTheme()

  useEffect(() => setMounted(true), [])

  return mounted && resolvedTheme === 'light' ? 'light' : 'dark'
}

function toWidgetHeight(value: number | string) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return `${value}px`
  }

  return typeof value === 'number' ? `${value}px` : value
}

function getWidgetFrameStyle(height: number | string, theme: TradingViewTheme) {
  return {
    colorScheme: theme,
    height: toWidgetHeight(height),
    '--tv-widget-accent-color': theme === 'dark' ? '#38bdf8' : '#0284c7',
    '--tv-widget-background-color': theme === 'dark' ? tradingViewDarkBackground : '#ffffff',
    '--tv-widget-negative-area-bottom-color':
      theme === 'dark' ? 'rgba(248, 113, 113, 0.08)' : 'rgba(220, 38, 38, 0.08)',
    '--tv-widget-negative-area-top-color':
      theme === 'dark' ? 'rgba(248, 113, 113, 0.22)' : 'rgba(220, 38, 38, 0.18)',
    '--tv-widget-negative-color': theme === 'dark' ? '#f87171' : '#dc2626',
    '--tv-widget-positive-area-bottom-color':
      theme === 'dark' ? 'rgba(45, 212, 191, 0.08)' : 'rgba(13, 148, 136, 0.08)',
    '--tv-widget-positive-area-top-color':
      theme === 'dark' ? 'rgba(45, 212, 191, 0.22)' : 'rgba(13, 148, 136, 0.18)',
    '--tv-widget-positive-color': theme === 'dark' ? '#2dd4bf' : '#0d9488',
    '--tv-widget-price-text-color': theme === 'dark' ? '#e2e8f0' : '#334155',
    '--tv-widget-scales-font-color': theme === 'dark' ? '#94a3b8' : '#64748b',
    '--tv-widget-text-color': theme === 'dark' ? '#cbd5e1' : '#475569',
  } as CSSProperties
}

function TradingViewWidgetFrame({ children, height, theme }: TradingViewWidgetFrameProps) {
  return (
    <div
      className="article-data-block not-prose dark:border-border-subtle-dark dark:bg-surface-code-dark my-7 overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-sm"
      style={getWidgetFrameStyle(height, theme)}
    >
      {children}
    </div>
  )
}

function TradingViewWidget({ config, scriptSrc }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

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

  return <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
}

export function TradingViewMiniChart({
  dateRange = '12M',
  height = 220,
  locale,
  symbol,
}: TradingViewMiniChartProps) {
  const theme = useTradingViewTheme()
  const tradingViewLocale = useTradingViewLocale()
  const resolvedLocale = locale ?? tradingViewLocale
  const normalizedSymbol = normalizeTradingViewSymbol(symbol)
  const config = useMemo(
    () => ({
      autosize: true,
      backgroundColor: theme === 'dark' ? 'rgba(16, 22, 31, 1)' : 'rgba(255, 255, 255, 1)',
      colorTheme: theme,
      dateRange,
      height: '100%',
      isTransparent: false,
      largeChartUrl: '',
      locale: resolvedLocale,
      symbol: normalizedSymbol,
      trendLineColor: theme === 'dark' ? 'rgba(56, 189, 248, 1)' : 'rgba(2, 132, 199, 1)',
      underLineBottomColor: theme === 'dark' ? 'rgba(56, 189, 248, 0)' : 'rgba(2, 132, 199, 0)',
      underLineColor: theme === 'dark' ? 'rgba(56, 189, 248, 0.18)' : 'rgba(2, 132, 199, 0.1)',
      width: '100%',
    }),
    [dateRange, resolvedLocale, normalizedSymbol, theme]
  )

  return (
    <TradingViewWidgetFrame height={height} theme={theme}>
      <TradingViewWidget config={config} scriptSrc={miniChartScript} />
    </TradingViewWidgetFrame>
  )
}

export function TradingViewAdvancedChart({
  height = 520,
  interval = 'D',
  locale,
  symbol,
  timezone = DEFAULT_TRADINGVIEW_TIMEZONE,
}: TradingViewAdvancedChartProps) {
  const theme = useTradingViewTheme()
  const tradingViewLocale = useTradingViewLocale()
  const resolvedLocale = locale ?? tradingViewLocale
  const normalizedSymbol = normalizeTradingViewSymbol(symbol)
  const config = useMemo(
    () => ({
      allow_symbol_change: true,
      autosize: true,
      backgroundColor: theme === 'dark' ? 'rgba(16, 22, 31, 1)' : 'rgba(255, 255, 255, 1)',
      calendar: false,
      enable_publishing: false,
      gridColor: theme === 'dark' ? 'rgba(64, 80, 100, 0.36)' : 'rgba(226, 232, 240, 1)',
      height: '100%',
      hide_top_toolbar: false,
      interval,
      locale: resolvedLocale,
      save_image: false,
      style: '1',
      support_host: 'https://www.tradingview.com',
      symbol: normalizedSymbol,
      theme,
      timezone,
      width: '100%',
    }),
    [interval, resolvedLocale, normalizedSymbol, theme, timezone]
  )

  return (
    <TradingViewWidgetFrame height={height} theme={theme}>
      <TradingViewWidget config={config} scriptSrc={advancedChartScript} />
    </TradingViewWidgetFrame>
  )
}
