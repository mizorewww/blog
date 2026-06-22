import { toIconComponentName } from '../../../lib/icons'
import type { MdastNode } from '../types'

const iconShortcodePattern = /:icon-([A-Za-z0-9_-]+):/g

function createIconNode(name: string): MdastNode {
  return {
    type: 'mdxJsxTextElement',
    name: 'Icon',
    attributes: [
      {
        type: 'mdxJsxAttribute',
        name: 'name',
        value: toIconComponentName(name),
      },
    ],
    children: [],
  }
}

function transformIconShortcodes(parent: MdastNode) {
  if (!Array.isArray(parent.children)) {
    return
  }

  parent.children = parent.children.flatMap((child) => {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      transformIconShortcodes(child)
      return [child]
    }

    const nodes: MdastNode[] = []
    let lastIndex = 0

    for (const match of child.value.matchAll(iconShortcodePattern)) {
      const index = match.index || 0
      const [raw, iconName] = match

      if (index > lastIndex) {
        nodes.push({
          ...child,
          value: child.value.slice(lastIndex, index),
        })
      }

      nodes.push(createIconNode(iconName))
      lastIndex = index + raw.length
    }

    if (nodes.length === 0) {
      return [child]
    }

    if (lastIndex < child.value.length) {
      nodes.push({
        ...child,
        value: child.value.slice(lastIndex),
      })
    }

    return nodes
  })
}

export function remarkIconShortcodes() {
  return (tree: MdastNode) => transformIconShortcodes(tree)
}
