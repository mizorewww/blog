import { isTradingViewTicker, normalizeTradingViewSymbol } from '../../../lib/tradingview'
import type { MdastNode } from '../types'
import { createMdxFlowNode, parseEmbedAttributes } from './mdxNodes'

type TradingViewAttrs = {
  height?: string
  interval?: string
  locale?: string
  timezone?: string
}

const tradingViewMiniPattern = /^\$([A-Za-z0-9._:-]+)$/
const tradingViewAdvancedPattern = /^::(?:tv|tv-advanced|tradingview)\s+(.+)$/

function createTradingViewMiniNode(symbol: string): MdastNode | null {
  if (!isTradingViewTicker(symbol)) {
    return null
  }

  return createMdxFlowNode('TradingViewMiniChart', {
    symbol: normalizeTradingViewSymbol(symbol),
  })
}

function createTradingViewAdvancedNode(source: string): MdastNode | null {
  const [rawSymbol, ...attrParts] = source.trim().split(/\s+/)

  if (!rawSymbol || !isTradingViewTicker(rawSymbol)) {
    return null
  }

  const attrs = parseEmbedAttributes<TradingViewAttrs>(attrParts.join(' '))

  return createMdxFlowNode('TradingViewAdvancedChart', {
    height: attrs.height,
    interval: attrs.interval,
    locale: attrs.locale,
    symbol: normalizeTradingViewSymbol(rawSymbol),
    timezone: attrs.timezone,
  })
}

function transformTradingViewWidgets(parent: MdastNode) {
  if (!Array.isArray(parent.children)) {
    return
  }

  const nextChildren: MdastNode[] = []

  for (const child of parent.children) {
    const value =
      child.type === 'paragraph' &&
      child.children?.length === 1 &&
      child.children[0].type === 'text' &&
      typeof child.children[0].value === 'string'
        ? child.children[0].value.trim()
        : ''

    const miniMatch = value.match(tradingViewMiniPattern)
    const advancedMatch = value.match(tradingViewAdvancedPattern)
    const widgetNode = miniMatch
      ? createTradingViewMiniNode(miniMatch[1])
      : advancedMatch
        ? createTradingViewAdvancedNode(advancedMatch[1])
        : null

    if (widgetNode) {
      nextChildren.push(widgetNode)
      continue
    }

    transformTradingViewWidgets(child)
    nextChildren.push(child)
  }

  parent.children = nextChildren
}

export function remarkTradingViewWidgets() {
  return (tree: MdastNode) => transformTradingViewWidgets(tree)
}
