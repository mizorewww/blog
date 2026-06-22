import { createGitHubIconNode } from '../svgs'
import type { HastNode } from '../types'

const languageNames: Record<string, string> = {
  bash: 'Bash',
  css: 'CSS',
  diff: 'Diff',
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
    value.startsWith('new file') ||
    value.startsWith('deleted file') ||
    value.startsWith('---') ||
    value.startsWith('+++')
  ) {
    return 'meta'
  }

  return ''
}

function findChildElement(node: HastNode, tagName: string): HastNode | undefined {
  return node.children?.find((child) => child.tagName === tagName)
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

function getLanguageName(language: string) {
  return languageNames[language] || language.toUpperCase()
}

function getLanguageIconLabel(language: string) {
  return languageIconLabels[language] || getLanguageName(language).slice(0, 3).toUpperCase()
}

function createCodeLanguageIconNode(language: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      'aria-hidden': 'true',
      className: ['code-language-icon'],
      'data-code-language': language,
    },
    children: [{ type: 'text', value: getLanguageIconLabel(language) }],
  }
}

function createCodeTitleNode(titleText: string, language: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['code-title-main'] },
    children: [
      createCodeLanguageIconNode(language),
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['code-title-text'] },
        children: [{ type: 'text', value: titleText || getLanguageName(language) }],
      },
    ],
  }
}

function createCodeSourceLinkNode(sourceUrl: string, language: string): HastNode {
  return {
    type: 'element',
    tagName: 'a',
    properties: {
      className: ['code-source-link'],
      href: sourceUrl,
      rel: 'noopener noreferrer',
      target: '_blank',
    },
    children: [
      createGitHubIconNode(),
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['code-source-link-text'] },
        children: [
          {
            type: 'text',
            value: language === 'diff' ? '在 GitHub 查看 diff' : '在 GitHub 查看代码',
          },
        ],
      },
    ],
  }
}

function ensureCodeTitle(node: HastNode): HastNode {
  const existingTitle = findChildElement(node, 'figcaption')

  if (existingTitle) {
    return existingTitle
  }

  const title: HastNode = {
    type: 'element',
    tagName: 'figcaption',
    properties: { 'data-rehype-pretty-code-title': '' },
    children: [],
  }

  node.children = Array.isArray(node.children) ? [title, ...node.children] : [title]

  return title
}

function enhanceCodeTitle(node: HastNode) {
  if (
    node.tagName !== 'figure' ||
    node.properties?.['data-rehype-pretty-code-figure'] === undefined
  ) {
    return
  }

  const title = ensureCodeTitle(node)
  const code = findDescendantElement(node, 'code')
  const sourceUrl = typeof code?.data?.githubSourceUrl === 'string' ? code.data.githubSourceUrl : ''
  const language = getCodeLanguage(code)
  const titleText = getNodeText(title) || getLanguageName(language)

  title.children = [createCodeTitleNode(titleText, language)]

  if (sourceUrl) {
    title.children.push(createCodeSourceLinkNode(sourceUrl, language))
  }
}

function annotateCodeLines(node: HastNode, language = '') {
  enhanceCodeTitle(node)

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
