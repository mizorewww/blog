import type { HastNode } from '../types'

const languageNames: Record<string, string> = {
  bash: 'Bash',
  css: 'CSS',
  diff: 'Diff',
  echarts: 'ECharts',
  html: 'HTML',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  md: 'Markdown',
  mdx: 'MDX',
  plaintext: 'Plain text',
  sh: 'Shell',
  shell: 'Shell',
  ts: 'TypeScript',
  tsx: 'TSX',
  txt: 'Plain text',
  yaml: 'YAML',
  yml: 'YAML',
  zsh: 'Zsh',
}

const languageIconLabels: Record<string, string> = {
  bash: '$',
  css: '#',
  diff: '±',
  html: '<>',
  js: 'JS',
  json: '{}',
  jsx: 'JSX',
  md: 'MD',
  mdx: 'MDX',
  plaintext: 'TXT',
  sh: '$',
  shell: '$',
  ts: 'TS',
  tsx: 'TSX',
  txt: 'TXT',
  yaml: 'YML',
  yml: 'YML',
  zsh: '$',
}

function getNodeText(node: HastNode): string {
  if (typeof node.value === 'string') {
    return node.value
  }

  return Array.isArray(node.children) ? node.children.map(getNodeText).join('') : ''
}

function getDiffLineKind(value: string) {
  if (value.startsWith('@@')) return 'hunk'
  if (value.startsWith('+') && !value.startsWith('+++')) return 'add'
  if (value.startsWith('-') && !value.startsWith('---')) return 'remove'
  if (
    value.startsWith('diff --git') ||
    value.startsWith('index ') ||
    value.startsWith('new file ') ||
    value.startsWith('deleted file ') ||
    value.startsWith('---') ||
    value.startsWith('+++')
  ) {
    return 'meta'
  }

  return ''
}

function findDescendantElement(node: HastNode, tagName: string): HastNode | undefined {
  if (node.tagName === tagName) {
    return node
  }

  if (!Array.isArray(node.children)) {
    return undefined
  }

  for (const child of node.children) {
    const match = findDescendantElement(child, tagName)

    if (match) {
      return match
    }
  }

  return undefined
}

function normalizeCodeLanguage(language: string) {
  return language.trim().toLowerCase() || 'plaintext'
}

function getCodeLanguage(code?: HastNode) {
  const value = code?.properties?.['data-language']
  return typeof value === 'string' ? normalizeCodeLanguage(value) : 'plaintext'
}

function getLanguageIconLabel(language: string) {
  const name = languageNames[language] || language.toUpperCase()
  return languageIconLabels[language] || name.slice(0, 3).toUpperCase()
}

/*
 * Code blocks render without any title bar chrome. Whatever a fence carries
 * (title, GitHub source url, language) is flattened onto the <pre> as data
 * attributes; CodeBlock decides how to present them:
 * - untitled blocks: bare language logo + copy button floating top-right
 * - titled/sourced blocks: one quiet text row above the code
 */
function flattenCodeChrome(node: HastNode) {
  if (
    node.tagName !== 'figure' ||
    node.properties?.['data-rehype-pretty-code-figure'] === undefined ||
    !Array.isArray(node.children)
  ) {
    return
  }

  const code = findDescendantElement(node, 'code')
  const pre = findDescendantElement(node, 'pre')
  const sourceUrl = typeof code?.data?.githubSourceUrl === 'string' ? code.data.githubSourceUrl : ''
  const language = getCodeLanguage(code)

  const titleIndex = node.children.findIndex((child) => child.tagName === 'figcaption')
  let titleText = ''

  if (titleIndex >= 0) {
    titleText = getNodeText(node.children[titleIndex]).trim()
    node.children.splice(titleIndex, 1)
  }

  if (pre) {
    pre.properties = {
      ...pre.properties,
      'data-code-language': language,
      'data-language-label': getLanguageIconLabel(language),
      ...(titleText ? { 'data-code-title': titleText } : {}),
      ...(sourceUrl ? { 'data-source-url': sourceUrl } : {}),
    }
  }
}

function annotateCodeLines(node: HastNode, language = '') {
  flattenCodeChrome(node)

  const properties = node.properties || {}
  const nextLanguage =
    typeof properties['data-language'] === 'string' ? properties['data-language'] : language

  if (properties['data-line'] !== undefined) {
    properties['data-code-line'] = ''

    if (nextLanguage === 'diff') {
      const diffLineKind = getDiffLineKind(getNodeText(node))

      if (diffLineKind) {
        properties['data-diff-line'] = diffLineKind
      }
    }

    node.properties = properties
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      annotateCodeLines(child, nextLanguage)
    }
  }
}

export function rehypeCodeLineMetadata() {
  return (tree: HastNode) => annotateCodeLines(tree)
}
