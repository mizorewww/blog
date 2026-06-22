import type { HastNode } from '../types'

const codeSourceUrlPattern = /\s*sourceUrl="([^"]*)"/

function extractCodeSourceMetadata(node: HastNode) {
  if (!node.data) {
    return
  }

  const meta = typeof node.data.meta === 'string' ? node.data.meta : ''
  const sourceUrl = meta.match(codeSourceUrlPattern)?.[1]

  if (!sourceUrl) {
    return
  }

  node.data.githubSourceUrl = sourceUrl
  node.data.meta = meta.replace(codeSourceUrlPattern, '').trim()
}

function collectCodeSourceMetadata(node: HastNode) {
  if (node.tagName === 'code') {
    extractCodeSourceMetadata(node)
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectCodeSourceMetadata(child)
    }
  }
}

export function rehypeCodeSourceMetadata() {
  return (tree: HastNode) => collectCodeSourceMetadata(tree)
}
