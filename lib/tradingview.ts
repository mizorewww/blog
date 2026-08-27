const explicitTradingViewSymbolPattern = /^[A-Z0-9._-]+:[A-Z0-9._-]+$/
const plainTickerPattern = /^[A-Z][A-Z0-9._-]{0,15}$/

// Common cryptocurrency symbols mapped to Binance USDT pair by default
const COMMON_CRYPTO_SYMBOLS = new Set([
  '1INCH',
  'AAVE',
  'ADA',
  'AI16Z',
  'AKT',
  'ALGO',
  'APE',
  'APT',
  'ARB',
  'ATOM',
  'AVAX',
  'AXS',
  'BCH',
  'BEAM',
  'BERA',
  'BLUR',
  'BOME',
  'BONK',
  'BTC',
  'CHZ',
  'COMP',
  'CRV',
  'DASH',
  'DOGE',
  'DOT',
  'DYDX',
  'EGLD',
  'ENA',
  'ENS',
  'EOS',
  'ETC',
  'ETH',
  'FARTCOIN',
  'FET',
  'FIL',
  'FLOKI',
  'FLOW',
  'FTM',
  'GALA',
  'GRT',
  'HBAR',
  'ICP',
  'INJ',
  'IO',
  'IOTA',
  'IP',
  'JASMY',
  'JUP',
  'KAIA',
  'KAS',
  'KAVA',
  'LDO',
  'LINK',
  'LTC',
  'MANA',
  'MATIC',
  'MELANIA',
  'MEW',
  'MKR',
  'MOVE',
  'NEAR',
  'NEIRO',
  'NEO',
  'NOT',
  'OM',
  'ONDO',
  'OP',
  'ORDI',
  'PENDLE',
  'PEPE',
  'POL',
  'POPCAT',
  'PYTH',
  'QNT',
  'RENDER',
  'RONIN',
  'RUNE',
  'SAND',
  'SATS',
  'SEI',
  'SHIB',
  'SNX',
  'SOL',
  'SONIC',
  'STRK',
  'STX',
  'SUI',
  'SUSHI',
  'TAO',
  'TIA',
  'TON',
  'TRUMP',
  'TRX',
  'UNI',
  'VET',
  'VIRTUAL',
  'W',
  'WIF',
  'WLD',
  'XLM',
  'XMR',
  'XRP',
  'ZEC',
  'ZRO',
])

export function normalizeTradingViewSymbol(value: string, defaultExchange = 'NASDAQ') {
  const symbol = value.trim().replace(/^\$/, '').toUpperCase()

  if (!symbol) {
    return ''
  }

  if (explicitTradingViewSymbolPattern.test(symbol)) {
    return symbol
  }

  if (plainTickerPattern.test(symbol)) {
    if (COMMON_CRYPTO_SYMBOLS.has(symbol)) {
      return `BINANCE:${symbol}USDT`
    }

    if (symbol.endsWith('USDT') || symbol.endsWith('USDC') || symbol.endsWith('BUSD')) {
      return `BINANCE:${symbol}`
    }

    return `${defaultExchange}:${symbol}`
  }

  return symbol
}

export function isTradingViewTicker(value: string) {
  const symbol = value.trim().replace(/^\$/, '').toUpperCase()
  return explicitTradingViewSymbolPattern.test(symbol) || plainTickerPattern.test(symbol)
}
