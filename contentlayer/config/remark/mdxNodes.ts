import type { MdastNode } from '../types'

export function parseEmbedAttributes<T extends object>(value: string) {
  const attrs: Record<string, string> = {}
  const attrPattern = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g

  for (const match of value.matchAll(attrPattern)) {
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    const attrValue = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[key] = attrValue
  }

  return attrs as T
}

export function createMdxFlowNode(
  name: string,
  attributes: Record<string, string | undefined>
): MdastNode {
  return {
    type: 'mdxJsxFlowElement',
    name,
    attributes: Object.entries(attributes)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([attrName, value]) => ({
        type: 'mdxJsxAttribute',
        name: attrName,
        value,
      })),
    children: [],
  }
}
