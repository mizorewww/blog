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
    <div className="not-prose my-8 overflow-hidden rounded-xl border border-slate-200/90 bg-slate-50/70 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-3.5 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="flex h-3 w-3 items-center justify-center">
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              回测性能看板 · 35Δ 周末卖方策略 (Short Strangle)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Deribit 官方公开历史 · 2022-09-02 ~ 2026-08-21 (共 208 周末) · 单利币本位
            </p>
          </div>
        </div>

        {/* Asset Toggle Tabs */}
        <div className="inline-flex rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800">
          {(['BTC', 'ETH'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setAsset(tab)}
              className={`rounded-md px-3.5 py-1 text-xs font-semibold transition-all ${
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

      {/* Primary Key Stats Grid (TradingView Style) */}
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-slate-200/60 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            净利润 (Net Profit)
          </div>
          <div className="mt-1 text-base font-bold text-emerald-600 dark:text-emerald-400">
            {m.totalPnl}
          </div>
          <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {m.totalPnlPct} ({m.totalPnlUsd})
          </div>
        </div>

        <div className="rounded-lg border border-slate-200/60 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            胜率 (Win Rate)
          </div>
          <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
            {m.winRate}
          </div>
          <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {m.winCount} 胜 / {m.lossCount} 负 (共 208 周)
          </div>
        </div>

        <div className="rounded-lg border border-slate-200/60 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            盈利因子 (Profit Factor)
          </div>
          <div className="mt-1 text-base font-bold text-blue-600 dark:text-blue-400">
            {m.profitFactor}
          </div>
          <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            总盈利 / |总亏损|
          </div>
        </div>

        <div className="rounded-lg border border-slate-200/60 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            夏普比率 (Sharpe)
          </div>
          <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
            {m.sharpe}
          </div>
          <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            周频收益 × √52 年化
          </div>
        </div>

        <div className="rounded-lg border border-slate-200/60 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            最大回撤 (Max Drawdown)
          </div>
          <div className="mt-1 text-base font-bold text-rose-600 dark:text-rose-400">{m.maxDd}</div>
          <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            名义回撤 {m.maxDdPct}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200/60 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            权利金留存率
          </div>
          <div className="mt-1 text-base font-bold text-amber-600 dark:text-amber-400">
            {m.retained}
          </div>
          <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            总保费 {m.totalPremium}
          </div>
        </div>
      </div>

      {/* Secondary Metrics Detail Table */}
      <div className="border-t border-slate-200/70 bg-white/60 px-5 py-3 text-xs dark:border-slate-800/80 dark:bg-slate-950/40">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">周均期望收益</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{m.avgWeekly}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">平均盈利 / 亏损周</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              <span className="text-emerald-600 dark:text-emerald-400">{m.avgWin}</span> /{' '}
              <span className="text-rose-600 dark:text-rose-400">{m.avgLoss}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">单笔最好 / 最差</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              <span className="text-emerald-600 dark:text-emerald-400">{m.bestWeek}</span> /{' '}
              <span className="text-rose-600 dark:text-rose-400">{m.worstWeek}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">累计手续费支出</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{m.fees}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
