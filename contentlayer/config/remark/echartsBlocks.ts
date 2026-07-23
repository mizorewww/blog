import type { MdastNode } from '../types'
import { createMdxFlowNode, parseEmbedAttributes } from './mdxNodes'

type EChartsAttrs = {
  height?: string
  title?: string
}

function isValidChartOption(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function createEChartsNode(code: MdastNode): MdastNode | null {
  const option = typeof code.value === 'string' ? code.value.trim() : ''

  if (!option || !isValidChartOption(option)) {
    return null
  }

  const attrs = parseEmbedAttributes<EChartsAttrs>(typeof code.meta === 'string' ? code.meta : '')

  return createMdxFlowNode('ECharts', {
    height: attrs.height,
    option,
    title: attrs.title,
  })
}

function transformEChartsBlocks(parent: MdastNode) {
  if (!Array.isArray(parent.children)) {
    return
  }

  parent.children = parent.children.map((child) => {
    if (child.type === 'code' && child.lang === 'echarts') {
      const chartNode = createEChartsNode(child)

      if (chartNode) {
        return chartNode
      }
    }

    transformEChartsBlocks(child)
    return child
  })
}

export function remarkEChartsBlocks() {
  return (tree: MdastNode) => transformEChartsBlocks(tree)
}
