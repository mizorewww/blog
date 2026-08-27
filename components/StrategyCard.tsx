'use client'

import { useMemo, useState } from 'react'

export interface StrategyMetrics {
  name?: string
  unit?: string
  totalPnl?: string
  totalPnlPct?: string
  totalPnlUsd?: string
  winRate?: string
  winCount?: number | string
  lossCount?: number | string
  totalTrades?: number | string
  profitFactor?: string | number
  sharpe?: string | number
  maxDd?: string
  maxDdPct?: string
  retained?: string
  totalPremium?: string
  avgWeekly?: string
  avgWin?: string
  avgLoss?: string
  winLossRatio?: string
  bestWeek?: string
  worstWeek?: string
  fees?: string
  [key: string]: unknown
}

export type StrategyDataMap = Record<string, StrategyMetrics>

export interface StrategyCardProps {
  title?: string
  subtitle?: string
  data?: string | StrategyMetrics | StrategyDataMap
}

const DEFAULT_DATA: StrategyDataMap = {
  BTC: {
    name: 'Bitcoin',
    unit: 'BTC',
    totalPnl: '+1.166 BTC',
    totalPnlPct: '+116.6%',
    totalPnlUsd: '≈ $64,395',
    winRate: '81.25%',
    winCount: 169,
    lossCount: 39,
    profitFactor: '3.43',
    sharpe: '3.43',
    maxDd: '-0.105 BTC',
    maxDdPct: '-10.5%',
    retained: '47.1%',
    totalPremium: '2.475 BTC',
    avgWeekly: '+0.561%',
    avgWin: '+0.0097 BTC',
    avgLoss: '-0.0123 BTC',
    bestWeek: '+0.0269 BTC',
    worstWeek: '-0.0596 BTC',
    fees: '0.1389 BTC',
  },
  ETH: {
    name: 'Ethereum',
    unit: 'ETH',
    totalPnl: '+1.146 ETH',
    totalPnlPct: '+114.6%',
    totalPnlUsd: '≈ $2,418',
    winRate: '78.85%',
    winCount: 164,
    lossCount: 44,
    profitFactor: '2.30',
    sharpe: '2.19',
    maxDd: '-0.111 ETH',
    maxDdPct: '-11.1%',
    retained: '34.3%',
    totalPremium: '3.343 ETH',
    avgWeekly: '+0.551%',
    avgWin: '+0.0124 ETH',
    avgLoss: '-0.0201 ETH',
    bestWeek: '+0.0474 ETH',
    worstWeek: '-0.1018 ETH',
    fees: '0.1406 ETH',
  },
}

function parseStrategyData(raw?: string | StrategyMetrics | StrategyDataMap): StrategyDataMap {
  if (!raw) {
    return DEFAULT_DATA
  }

  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return DEFAULT_DATA
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return DEFAULT_DATA
  }

  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length === 0) {
    return DEFAULT_DATA
  }

  const isMultiAsset = entries.every(
    ([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v)
  )

  if (isMultiAsset) {
    return parsed as StrategyDataMap
  }

  return {
    默认标的: parsed as StrategyMetrics,
  }
}

export default function StrategyCard({
  title = '35Δ 周末卖方策略 (Short Strangle)',
  subtitle,
  data,
}: StrategyCardProps) {
  const dataset = useMemo(() => parseStrategyData(data), [data])
  const tabs = useMemo(() => Object.keys(dataset), [dataset])
  const [activeTab, setActiveTab] = useState<string>(tabs[0] || 'BTC')

  const currentTab = dataset[activeTab] ? activeTab : tabs[0]
  const m: StrategyMetrics = (currentTab && dataset[currentTab]) || {}

  const winCount = typeof m.winCount === 'number' ? m.winCount : Number(m.winCount) || 0
  const lossCount = typeof m.lossCount === 'number' ? m.lossCount : Number(m.lossCount) || 0
  const totalTrades = m.totalTrades ?? (winCount + lossCount > 0 ? winCount + lossCount : undefined)

  const winRateDetail =
    winCount > 0 || lossCount > 0
      ? `${winCount} 胜 / ${lossCount} 负${totalTrades ? ` (共 ${totalTrades} 笔/周)` : ''}`
      : totalTrades
        ? `共 ${totalTrades} 笔交易`
        : '统计周期内全量交易'

  const hasSecondary = Boolean(
    m.avgWeekly || m.avgWin || m.avgLoss || m.bestWeek || m.worstWeek || m.fees
  )

  return (
    <div className="article-data-block not-prose dark:border-border-subtle-dark dark:bg-surface-code-dark my-7 overflow-hidden rounded-[10px] border border-slate-200/90 bg-white shadow-sm dark:shadow-none">
      {/* Header Bar */}
      <div className="dark:border-border-subtle-dark flex flex-wrap items-center justify-between gap-3.5 border-b border-slate-200/80 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-3 w-3 items-center justify-center">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base dark:text-slate-100">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Asset Switcher Tabs */}
        {tabs.length > 1 && (
          <div className="inline-flex rounded-[6px] bg-slate-100 p-1 dark:bg-white/[0.06]">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-[4px] px-3.5 py-1 text-xs font-semibold transition-all ${
                  currentTab === tab
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-white/10 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white'
                }`}
              >
                {tab} 标的
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Primary Key Stats Grid (3 Columns x 2 Rows) */}
      <div className="grid grid-cols-1 gap-3.5 p-5 sm:grid-cols-2 sm:gap-4 sm:p-6 lg:grid-cols-3">
        {/* 1. Net Profit */}
        <div className="flex min-h-[110px] flex-col justify-between rounded-[8px] border border-slate-100 bg-slate-50/60 p-4 transition-colors hover:border-slate-200/80 dark:border-white/5 dark:bg-white/[0.025] dark:hover:border-white/10">
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-white/50">
            净利润 (Net Profit)
          </div>
          <div className="my-1.5 text-xl font-bold tracking-tight text-emerald-600 sm:text-2xl dark:text-emerald-400">
            {m.totalPnl || '-'}
          </div>
          <div className="text-xs text-slate-400 dark:text-white/40">
            {m.totalPnlPct || '-'}
            {m.totalPnlUsd ? ` (${m.totalPnlUsd})` : ''}
          </div>
        </div>

        {/* 2. Win Rate */}
        <div className="flex min-h-[110px] flex-col justify-between rounded-[8px] border border-slate-100 bg-slate-50/60 p-4 transition-colors hover:border-slate-200/80 dark:border-white/5 dark:bg-white/[0.025] dark:hover:border-white/10">
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-white/50">
            胜率 (Win Rate)
          </div>
          <div className="my-1.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
            {m.winRate || '-'}
          </div>
          <div className="text-xs text-slate-400 dark:text-white/40">{winRateDetail}</div>
        </div>

        {/* 3. Profit Factor */}
        <div className="flex min-h-[110px] flex-col justify-between rounded-[8px] border border-slate-100 bg-slate-50/60 p-4 transition-colors hover:border-slate-200/80 dark:border-white/5 dark:bg-white/[0.025] dark:hover:border-white/10">
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-white/50">
            盈利因子 (Profit Factor)
          </div>
          <div className="my-1.5 text-xl font-bold tracking-tight text-sky-600 sm:text-2xl dark:text-sky-400">
            {m.profitFactor || '-'}
          </div>
          <div className="text-xs text-slate-400 dark:text-white/40">总盈利 / |总亏损|</div>
        </div>

        {/* 4. Sharpe */}
        <div className="flex min-h-[110px] flex-col justify-between rounded-[8px] border border-slate-100 bg-slate-50/60 p-4 transition-colors hover:border-slate-200/80 dark:border-white/5 dark:bg-white/[0.025] dark:hover:border-white/10">
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-white/50">
            夏普比率 (Sharpe Ratio)
          </div>
          <div className="my-1.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
            {m.sharpe || '-'}
          </div>
          <div className="text-xs text-slate-400 dark:text-white/40">周频收益 × √52 年化</div>
        </div>

        {/* 5. Max Drawdown */}
        <div className="flex min-h-[110px] flex-col justify-between rounded-[8px] border border-slate-100 bg-slate-50/60 p-4 transition-colors hover:border-slate-200/80 dark:border-white/5 dark:bg-white/[0.025] dark:hover:border-white/10">
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-white/50">
            最大回撤 (Max DD)
          </div>
          <div className="my-1.5 text-xl font-bold tracking-tight text-rose-600 sm:text-2xl dark:text-rose-400">
            {m.maxDd || '-'}
          </div>
          <div className="text-xs text-slate-400 dark:text-white/40">
            名义回撤 {m.maxDdPct || '-'}
          </div>
        </div>

        {/* 6. Retention / Premium */}
        <div className="flex min-h-[110px] flex-col justify-between rounded-[8px] border border-slate-100 bg-slate-50/60 p-4 transition-colors hover:border-slate-200/80 dark:border-white/5 dark:bg-white/[0.025] dark:hover:border-white/10">
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-white/50">
            权利金留存率 (Retention)
          </div>
          <div className="my-1.5 text-xl font-bold tracking-tight text-amber-600 sm:text-2xl dark:text-amber-400">
            {m.retained || '-'}
          </div>
          <div className="text-xs text-slate-400 dark:text-white/40">
            总保费 {m.totalPremium || '-'}
          </div>
        </div>
      </div>

      {/* Secondary Detail Row */}
      {hasSecondary && (
        <div className="dark:border-border-subtle-dark border-t border-slate-200/80 bg-slate-50/40 px-5 py-3.5 sm:px-6 dark:bg-white/[0.015]">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 sm:gap-x-8">
            {m.avgWeekly && (
              <div>
                <div className="text-xs text-slate-500 dark:text-white/50">周均期望收益率</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {m.avgWeekly}
                </div>
              </div>
            )}
            {(m.avgWin || m.avgLoss) && (
              <div>
                <div className="text-xs text-slate-500 dark:text-white/50">平均盈利 / 亏损周</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <span className="text-emerald-600 dark:text-emerald-400">{m.avgWin || '-'}</span>{' '}
                  / <span className="text-rose-600 dark:text-rose-400">{m.avgLoss || '-'}</span>
                </div>
              </div>
            )}
            {(m.bestWeek || m.worstWeek) && (
              <div>
                <div className="text-xs text-slate-500 dark:text-white/50">单笔最好 / 最差</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {m.bestWeek || '-'}
                  </span>{' '}
                  / <span className="text-rose-600 dark:text-rose-400">{m.worstWeek || '-'}</span>
                </div>
              </div>
            )}
            {m.fees && (
              <div>
                <div className="text-xs text-slate-500 dark:text-white/50">累计手续费支出</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {m.fees}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
