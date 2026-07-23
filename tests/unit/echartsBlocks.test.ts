import { describe, expect, it } from 'vitest'
import { remarkEChartsBlocks } from '../../contentlayer/config/remark/echartsBlocks'
import type { MdastNode } from '../../contentlayer/config/types'

function createTree(children: MdastNode[]): MdastNode {
  return { type: 'root', children }
}

function createCodeNode(value: string, lang = 'echarts', meta?: string): MdastNode {
  return { type: 'code', lang, meta, value }
}

function transform(tree: MdastNode) {
  remarkEChartsBlocks()(tree)
  return tree
}

describe('remarkEChartsBlocks', () => {
  it('converts an echarts code block with a valid JSON option into an ECharts component', () => {
    const option = JSON.stringify({ series: [{ type: 'bar', data: [1, 2, 3] }] })
    const tree = transform(
      createTree([createCodeNode(option, 'echarts', 'title="销量" height=420')])
    )

    const node = tree.children?.[0]

    expect(node?.type).toBe('mdxJsxFlowElement')
    expect(node?.name).toBe('ECharts')

    const attributes = node?.attributes as { name: string; value: string }[]
    const attrs = Object.fromEntries(attributes.map((attr) => [attr.name, attr.value]))

    expect(attrs.option).toBe(option)
    expect(attrs.title).toBe('销量')
    expect(attrs.height).toBe('420')
  })

  it.each([
    ['invalid JSON', '{not json'],
    ['a JSON array', '[1, 2, 3]'],
    ['a JSON scalar', '42'],
    ['empty content', ''],
  ])('leaves %s untouched as a code block', (_label, value) => {
    const code = createCodeNode(value)
    const tree = transform(createTree([code]))

    expect(tree.children?.[0]).toBe(code)
    expect(tree.children?.[0].type).toBe('code')
  })

  it('ignores code blocks in other languages', () => {
    const code = createCodeNode('{"series": []}', 'json')
    const tree = transform(createTree([code]))

    expect(tree.children?.[0]).toBe(code)
  })
})
