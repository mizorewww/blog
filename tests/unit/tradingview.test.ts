import { describe, expect, it } from 'vitest'
import { isTradingViewTicker, normalizeTradingViewSymbol } from '../../lib/tradingview'

describe('normalizeTradingViewSymbol', () => {
  it('normalizes common crypto tickers to Binance USDT pair', () => {
    expect(normalizeTradingViewSymbol('$BTC')).toBe('BINANCE:BTCUSDT')
    expect(normalizeTradingViewSymbol('BTC')).toBe('BINANCE:BTCUSDT')
    expect(normalizeTradingViewSymbol('$ETH')).toBe('BINANCE:ETHUSDT')
    expect(normalizeTradingViewSymbol('SOL')).toBe('BINANCE:SOLUSDT')
    expect(normalizeTradingViewSymbol('$DOGE')).toBe('BINANCE:DOGEUSDT')
  })

  it('normalizes crypto tickers ending with USDT/USDC/BUSD to Binance pair', () => {
    expect(normalizeTradingViewSymbol('BTCUSDT')).toBe('BINANCE:BTCUSDT')
    expect(normalizeTradingViewSymbol('$ETHUSDC')).toBe('BINANCE:ETHUSDC')
  })

  it('preserves explicit exchange prefix', () => {
    expect(normalizeTradingViewSymbol('BINANCE:BTCUSDT')).toBe('BINANCE:BTCUSDT')
    expect(normalizeTradingViewSymbol('COINBASE:BTCUSD')).toBe('COINBASE:BTCUSD')
    expect(normalizeTradingViewSymbol('NYSE:BABA')).toBe('NYSE:BABA')
    expect(normalizeTradingViewSymbol('NASDAQ:AAPL')).toBe('NASDAQ:AAPL')
  })

  it('defaults non-crypto plain tickers to NASDAQ exchange', () => {
    expect(normalizeTradingViewSymbol('$AAPL')).toBe('NASDAQ:AAPL')
    expect(normalizeTradingViewSymbol('TSLA')).toBe('NASDAQ:TSLA')
    expect(normalizeTradingViewSymbol('MSFT')).toBe('NASDAQ:MSFT')
  })

  it('handles empty input gracefully', () => {
    expect(normalizeTradingViewSymbol('')).toBe('')
    expect(normalizeTradingViewSymbol('   ')).toBe('')
  })
})

describe('isTradingViewTicker', () => {
  it('identifies valid tickers correctly', () => {
    expect(isTradingViewTicker('$BTC')).toBe(true)
    expect(isTradingViewTicker('BINANCE:BTCUSDT')).toBe(true)
    expect(isTradingViewTicker('AAPL')).toBe(true)
    expect(isTradingViewTicker('$NASDAQ:AAPL')).toBe(true)
  })

  it('rejects invalid strings', () => {
    expect(isTradingViewTicker('')).toBe(false)
    expect(isTradingViewTicker('   ')).toBe(false)
    expect(isTradingViewTicker('invalid ticker with spaces')).toBe(false)
  })
})
