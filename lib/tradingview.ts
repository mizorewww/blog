const explicitTradingViewSymbolPattern = /^[A-Z0-9._-]+:[A-Z0-9._-]+$/
const plainTickerPattern = /^[A-Z][A-Z0-9._-]{0,15}$/

export function normalizeTradingViewSymbol(value: string, defaultExchange = 'NASDAQ') {
  const symbol = value.trim().replace(/^\$/, '').toUpperCase()

  if (!symbol) {
    return ''
  }

  if (explicitTradingViewSymbolPattern.test(symbol)) {
    return symbol
  }

  if (plainTickerPattern.test(symbol)) {
    return `${defaultExchange}:${symbol}`
  }

  return symbol
}

export function isTradingViewTicker(value: string) {
  const symbol = value.trim().replace(/^\$/, '').toUpperCase()
  return explicitTradingViewSymbolPattern.test(symbol) || plainTickerPattern.test(symbol)
}
