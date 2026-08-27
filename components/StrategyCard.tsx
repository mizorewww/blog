'use client'

import { useState } from 'react'

interface AssetMetrics {
  name: string
  unit: string
  totalPnl: string
  totalPnlPct: string
  totalPnlUsd: string
  winRate: string
  winCount: number
  lossCount: number
  profitFactor: string
  sharpe: string
  maxDd: string
  maxDdPct: string
  retained: string
  totalPremium: string
  avgWeekly: string
  avgWin: string
  avgLoss: string
  winLossRatio: string
  bestWeek: string
  worstWeek: string
  fees: string
}

const DATA: Record<'BTC' | 'ETH', AssetMetrics> = {
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
    winLossRatio: '0.79',
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
    winLossRatio: '0.62',
    bestWeek: '+0.0474 ETH',
    worstWeek: '-0.1018 ETH',
    fees: '0.1406 ETH',
  },
}

export default function StrategyCard() {
  const [asset, setAsset] = useState<'BTC' | 'ETH'>('BTC')
  const m = DATA[asset]

  return (
    <div className="not-prose my-10 overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-slate-100/60 shadow-md dark:border-slate-800 dark:from-slate-900/90 dark:to-slate-950/80">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 px-6 py-5 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <span className="flex h-3.5 w-3.5 items-center justify-center">
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
          </span>
          <div>
            <h3 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg dark:text-slate-100">
              回测性能总览 · 35Δ 周末卖方策略 (Short Strangle)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Deribit 官方公开历史行情 · 2022-09-02 ~ 2026-08-21 (共 208 周末) · 单利币本位口径
            </p>
          </div>
        </div>

        {/* Asset Switcher Tabs */}
        <div className="inline-flex rounded-xl bg-slate-200/80 p-1.5 dark:bg-slate-800">
          {(['BTC', 'ETH'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setAsset(tab)}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                asset === tab
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {tab} 标的
            </button>
          ))}
        </div>
      </div>

      {/* Primary Key Stats Grid (3 Columns x 2 Rows: Spacious, Taller, No Text Collision) */}
      <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 sm:p-7">
        <div className="flex min-h-[108px] flex-col justify-between rounded-xl border border-slate-200/70 bg-white/90 p-4 shadow-sm transition-all hover:shadow dark:border-slate-800/90 dark:bg-slate-950/70">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            净利润 (Net Profit)
          </div>
          <div className="my-1 text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {m.totalPnl}
          </div>
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            {m.totalPnlPct} ({m.totalPnlUsd})
          </div>
        </div>

        <div className="flex min-h-[108px] flex-col justify-between rounded-xl border border-slate-200/70 bg-white/90 p-4 shadow-sm transition-all hover:shadow dark:border-slate-800/90 dark:bg-slate-950/70">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            胜率 (Win Rate)
          </div>
          <div className="my-1 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {m.winRate}
          </div>
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            {m.winCount} 胜 / {m.lossCount} 负 (共 208 周)
          </div>
        </div>

        <div className="flex min-h-[108px] flex-col justify-between rounded-xl border border-slate-200/70 bg-white/90 p-4 shadow-sm transition-all hover:shadow dark:border-slate-800/90 dark:bg-slate-950/70">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            盈利因子 (Profit Factor)
          </div>
          <div className="my-1 text-xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {m.profitFactor}
          </div>
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            总盈利 / |总亏损|
          </div>
        </div>

        <div className="flex min-h-[108px] flex-col justify-between rounded-xl border border-slate-200/70 bg-white/90 p-4 shadow-sm transition-all hover:shadow dark:border-slate-800/90 dark:bg-slate-950/70">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            夏普比率 (Sharpe)
          </div>
          <div className="my-1 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {m.sharpe}
          </div>
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            周频收益 × √52 年化
          </div>
        </div>

        <div className="flex min-h-[108px] flex-col justify-between rounded-xl border border-slate-200/70 bg-white/90 p-4 shadow-sm transition-all hover:shadow dark:border-slate-800/90 dark:bg-slate-950/70">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            最大回撤 (Max DD)
          </div>
          <div className="my-1 text-xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
            {m.maxDd}
          </div>
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            名义回撤 {m.maxDdPct}
          </div>
        </div>

        <div className="flex min-h-[108px] flex-col justify-between rounded-xl border border-slate-200/70 bg-white/90 p-4 shadow-sm transition-all hover:shadow dark:border-slate-800/90 dark:bg-slate-950/70">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            权利金留存率 (Retention)
          </div>
          <div className="my-1 text-xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {m.retained}
          </div>
          <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
            总保费 {m.totalPremium}
          </div>
        </div>
      </div>

      {/* Secondary Metrics Detail Bar */}
      <div className="border-t border-slate-200/80 bg-white/70 px-6 py-4 text-xs dark:border-slate-800/90 dark:bg-slate-950/50">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">周均期望收益率</span>
            <span className="font-bold text-slate-900 dark:text-slate-100">{m.avgWeekly}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">平均盈利 / 亏损周</span>
            <span className="font-bold text-slate-900 dark:text-slate-100">
              <span className="text-emerald-600 dark:text-emerald-400">{m.avgWin}</span> /{' '}
              <span className="text-rose-600 dark:text-rose-400">{m.avgLoss}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">单笔最好 / 最差</span>
            <span className="font-bold text-slate-900 dark:text-slate-100">
              <span className="text-emerald-600 dark:text-emerald-400">{m.bestWeek}</span> /{' '}
              <span className="text-rose-600 dark:text-rose-400">{m.worstWeek}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">累计手续费支出</span>
            <span className="font-bold text-slate-900 dark:text-slate-100">{m.fees}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
