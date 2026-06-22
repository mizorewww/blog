import { defineDocumentType, ComputedFields, makeSource } from 'contentlayer2/source-files'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import readingTime from 'reading-time'
// Remark packages
import remarkGfm from 'remark-gfm'
// Rehype packages
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePresetMinify from 'rehype-preset-minify'
import rehypePrettyCode from 'rehype-pretty-code'
import { resolveCodeThemePreset } from './data/codeThemes'
import siteMetadata from './data/siteMetadata'
import { getPostImageUrls } from './lib/postImages'
import { absoluteSiteUrl } from './lib/urls'
import { defaultLocale, isLocale } from './lib/i18n'
import { toIconComponentName } from './lib/icons'
import { extractTocHeadings } from './lib/toc'
import { isTradingViewTicker, normalizeTradingViewSymbol } from './lib/tradingview'

const codeTheme = resolveCodeThemePreset(
  process.env.CODE_THEME || process.env.NEXT_PUBLIC_CODE_THEME
)

const rehypePrettyCodeOptions = {
  theme: {
    light: codeTheme.light,
    dark: codeTheme.dark,
  },
  keepBackground: true,
  defaultLang: {
    block: 'plaintext',
    inline: '',
  },
  bypassInlineCode: true,
}

const icon = {
  type: 'element',
  tagName: 'span',
  properties: { className: ['content-header-link'] },
  children: [
    {
      type: 'element',
      tagName: 'svg',
      properties: {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 20 20',
        fill: 'currentColor',
        className: ['h-5', 'linkicon', 'w-5'],
      },
      children: [
        {
          type: 'element',
          tagName: 'path',
          properties: {
            d: 'M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z',
          },
          children: [],
        },
        {
          type: 'element',
          tagName: 'path',
          properties: {
            d: 'M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z',
          },
          children: [],
        },
      ],
    },
  ],
}

type PostGitCommit = {
  hash: string
  shortHash: string
  committedAt: string
  subject: string
  url: string
}

const gitFieldSeparator = '\x1f'
const gitRecordSeparator = '\x1e'
const postGitHistoryCache = new Map<string, PostGitCommit[]>()
const siteRepo = (siteMetadata.siteRepo || '').replace(/\/+$/, '')

function getGitOutput(args: string[]) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function encodeGitHubPath(filePath: string) {
  return filePath.split('/').map(encodeURIComponent).join('/')
}

function getCommitUrl(hash: string) {
  return siteRepo && hash ? `${siteRepo}/commit/${hash}` : ''
}

function getFileUrl(filePath: string, ref = 'HEAD') {
  return siteRepo ? `${siteRepo}/blob/${ref}/${encodeGitHubPath(filePath)}` : ''
}

function getRepoSourceFilePath(doc: { _raw: { sourceFilePath: string } }) {
  const sourceFilePath = doc._raw.sourceFilePath.replace(/^\/+/, '')
  return sourceFilePath.startsWith('data/') ? sourceFilePath : `data/${sourceFilePath}`
}

function toIsoDate(value: unknown) {
  if (!value) return ''

  const date = new Date(value as string | Date)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function getPostGitHistory(filePath: string): PostGitCommit[] {
  const cachedHistory = postGitHistoryCache.get(filePath)

  if (cachedHistory) {
    return cachedHistory
  }

  const output = getGitOutput([
    'log',
    '--follow',
    `--format=%H%x1f%h%x1f%cI%x1f%s%x1e`,
    '--',
    filePath,
  ])
  const history = output
    .split(gitRecordSeparator)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, committedAt, ...subjectParts] = record.split(gitFieldSeparator)

      return {
        hash,
        shortHash,
        committedAt,
        subject: subjectParts.join(gitFieldSeparator),
        url: getCommitUrl(hash),
      }
    })
    .filter((commit) => commit.hash && commit.shortHash && commit.committedAt)

  postGitHistoryCache.set(filePath, history)

  return history
}

type MdastNode = {
  type?: string
  value?: string
  lang?: string
  meta?: string
  children?: MdastNode[]
  [key: string]: unknown
}

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

function remarkIconShortcodes() {
  return (tree: MdastNode) => transformIconShortcodes(tree)
}

type GitHubEmbedAttrs = {
  base?: string
  head?: string
  lang?: string
  lines?: string
  path?: string
  ref?: string
  repo?: string
  title?: string
}

type TradingViewAttrs = {
  height?: string
  interval?: string
  locale?: string
  timezone?: string
}

const githubEmbedPattern = /^::github-(code|diff)\s+(.+)$/
const tradingViewMiniPattern = /^\$([A-Za-z0-9._:-]+)$/
const tradingViewAdvancedPattern = /^::(?:tv|tv-advanced|tradingview)\s+(.+)$/
const codeSourceUrlPattern = /\s*sourceUrl="([^"]*)"/
const defaultGitHubRepo = siteRepo.replace(/^https:\/\/github\.com\//, '')

function parseEmbedAttributes(value: string): GitHubEmbedAttrs {
  const attrs: GitHubEmbedAttrs = {}
  const attrPattern = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g

  for (const match of value.matchAll(attrPattern)) {
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    const attrValue = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[key as keyof GitHubEmbedAttrs] = attrValue
  }

  return attrs
}

function createMdxFlowNode(
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

  const attrs = parseEmbedAttributes(attrParts.join(' ')) as TradingViewAttrs

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

function remarkTradingViewWidgets() {
  return (tree: MdastNode) => transformTradingViewWidgets(tree)
}

function normalizeGitHubRepo(repo?: string) {
  return (repo || defaultGitHubRepo).replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '')
}

function isSiteRepo(repo: string) {
  return Boolean(defaultGitHubRepo && repo === defaultGitHubRepo)
}

function getLocalGitFile(ref: string, filePath: string) {
  if (ref.toLowerCase() === 'worktree') {
    return readFileSync(filePath, 'utf8')
  }

  return getGitOutput(['show', `${ref}:${filePath}`])
}

function getGitHubLineFragment(lines?: string) {
  if (!lines) {
    return ''
  }

  const [rawStart, rawEnd] = lines.split(',')[0]?.split('-') || []
  const start = Number(rawStart)
  const end = Number(rawEnd || rawStart)

  if (!Number.isInteger(start) || start < 1) {
    return ''
  }

  return Number.isInteger(end) && end > start ? `#L${start}-L${end}` : `#L${start}`
}

function getGitHubCodeUrl(attrs: GitHubEmbedAttrs) {
  if (!attrs.path) {
    return ''
  }

  const repo = normalizeGitHubRepo(attrs.repo)
  const ref = attrs.ref || 'HEAD'
  return `https://github.com/${repo}/blob/${ref}/${encodeGitHubPath(attrs.path)}${getGitHubLineFragment(attrs.lines)}`
}

function getGitHubDiffUrl(attrs: GitHubEmbedAttrs) {
  const repo = normalizeGitHubRepo(attrs.repo)

  if (attrs.ref) {
    return `https://github.com/${repo}/commit/${attrs.ref}`
  }

  if (attrs.base && attrs.head) {
    return `https://github.com/${repo}/compare/${attrs.base}...${attrs.head}`
  }

  return ''
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'mizore-blog-contentlayer',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

async function getGitHubFile(attrs: GitHubEmbedAttrs) {
  if (!attrs.path) {
    throw new Error('github-code requires a path attribute')
  }

  const repo = normalizeGitHubRepo(attrs.repo)
  const ref = attrs.ref || 'HEAD'

  if (isSiteRepo(repo)) {
    const localFile = getLocalGitFile(ref, attrs.path)

    if (localFile) {
      return localFile
    }
  }

  return fetchText(`https://raw.githubusercontent.com/${repo}/${ref}/${attrs.path}`)
}

function selectCodeLines(value: string, lines?: string) {
  if (!lines) {
    return value
  }

  const sourceLines = value.split(/\r?\n/)
  const selectedLines: string[] = []

  for (const part of lines.split(',')) {
    const [rawStart, rawEnd] = part.split('-')
    const start = Number(rawStart)
    const end = Number(rawEnd || rawStart)

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      continue
    }

    selectedLines.push(...sourceLines.slice(start - 1, end))
  }

  return selectedLines.length > 0 ? selectedLines.join('\n') : value
}

function filterDiffByPath(diff: string, filePath?: string) {
  if (!filePath) {
    return diff
  }

  return diff
    .split(/(?=^diff --git )/m)
    .filter((block) => {
      const firstLine = block.split('\n')[0] || ''
      return firstLine.includes(` a/${filePath} b/${filePath}`)
    })
    .join('')
    .trim()
}

async function getGitHubDiff(attrs: GitHubEmbedAttrs) {
  const repo = normalizeGitHubRepo(attrs.repo)
  const ref = attrs.ref
  const base = attrs.base
  const head = attrs.head

  if (isSiteRepo(repo)) {
    const args = ref
      ? ['show', '--format=', '--patch', '--no-ext-diff', ref, '--']
      : ['diff', '--no-ext-diff', base || 'HEAD~1', head || 'HEAD', '--']

    if (attrs.path) {
      args.push(attrs.path)
    }

    const localDiff = getGitOutput(args)

    if (localDiff) {
      return localDiff
    }
  }

  const diff = ref
    ? await fetchText(`https://github.com/${repo}/commit/${ref}.diff`)
    : await fetchText(`https://github.com/${repo}/compare/${base}...${head}.diff`)

  return filterDiffByPath(diff, attrs.path)
}

function createCodeNode(
  value: string,
  lang: string,
  title?: string,
  options: { showLineNumbers?: boolean; sourceUrl?: string } = {}
): MdastNode {
  const meta = [
    options.showLineNumbers ? 'showLineNumbers' : '',
    title ? `title="${title.replace(/"/g, '\\"')}"` : '',
    options.sourceUrl ? `sourceUrl="${options.sourceUrl.replace(/"/g, '\\"')}"` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    type: 'code',
    lang,
    meta: meta || undefined,
    value: value.trimEnd(),
  }
}

function createEmbedErrorNode(message: string): MdastNode {
  return createCodeNode(message, 'text', 'GitHub embed failed')
}

async function createGitHubEmbedNode(kind: string, attrSource: string): Promise<MdastNode> {
  const attrs = parseEmbedAttributes(attrSource)

  try {
    if (kind === 'code') {
      const value = selectCodeLines(await getGitHubFile(attrs), attrs.lines)
      const title =
        attrs.title ||
        `${normalizeGitHubRepo(attrs.repo)}:${attrs.path}${attrs.lines ? `#L${attrs.lines}` : ''}`

      return createCodeNode(value, attrs.lang || 'text', title, {
        showLineNumbers: true,
        sourceUrl: getGitHubCodeUrl(attrs),
      })
    }

    const value = selectCodeLines(await getGitHubDiff(attrs), attrs.lines)
    const title =
      attrs.title ||
      `${normalizeGitHubRepo(attrs.repo)}:${attrs.path || `${attrs.base || attrs.ref}...${attrs.head || ''}`}`

    return createCodeNode(value || 'No diff matched this query.', attrs.lang || 'diff', title, {
      showLineNumbers: true,
      sourceUrl: getGitHubDiffUrl(attrs),
    })
  } catch (error) {
    return createEmbedErrorNode(error instanceof Error ? error.message : String(error))
  }
}

async function transformGitHubEmbeds(parent: MdastNode) {
  if (!Array.isArray(parent.children)) {
    return
  }

  const nextChildren: MdastNode[] = []

  for (const child of parent.children) {
    const match =
      child.type === 'paragraph' &&
      child.children?.length === 1 &&
      child.children[0].type === 'text' &&
      typeof child.children[0].value === 'string'
        ? child.children[0].value.match(githubEmbedPattern)
        : null

    if (match) {
      nextChildren.push(await createGitHubEmbedNode(match[1], match[2]))
      continue
    }

    await transformGitHubEmbeds(child)
    nextChildren.push(child)
  }

  parent.children = nextChildren
}

function remarkGitHubEmbeds() {
  return async (tree: MdastNode) => transformGitHubEmbeds(tree)
}

type HastNode = {
  data?: Record<string, unknown>
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

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

function rehypeCodeSourceMetadata() {
  return (tree: HastNode) => collectCodeSourceMetadata(tree)
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

function createGitHubIconNode(): HastNode {
  return {
    type: 'element',
    tagName: 'svg',
    properties: {
      'aria-hidden': 'true',
      className: ['code-source-link-icon'],
      fill: 'currentColor',
      viewBox: '0 0 24 24',
    },
    children: [
      {
        type: 'element',
        tagName: 'path',
        properties: {
          d: 'M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.03c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.35.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18A10.9 10.9 0 0 1 12 6.15c.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12v3.08c0 .31.21.67.79.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z',
        },
        children: [],
      },
    ],
  }
}

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

function rehypeCodeLineMetadata() {
  return (tree: HastNode) => annotateCodeLines(tree)
}

const computedFields: ComputedFields = {
  readingTime: { type: 'json', resolve: (doc) => readingTime(doc.body.raw) },
  slug: {
    type: 'string',
    resolve: (doc) => doc._raw.flattenedPath.replace(/^.+?(\/)/, ''),
  },
  path: {
    type: 'string',
    resolve: (doc) => doc._raw.flattenedPath,
  },
  filePath: {
    type: 'string',
    resolve: (doc) => doc._raw.sourceFilePath,
  },
  toc: { type: 'json', resolve: (doc) => extractTocHeadings(doc.body.raw) },
}

const rawBlogSlug = (doc) => doc._raw.flattenedPath.replace(/^.+?(\/)/, '')

const blogLocale = (doc) => {
  const frontmatterLocale = doc.language
  const firstSegment = rawBlogSlug(doc).split('/')[0]

  if (isLocale(frontmatterLocale)) {
    return frontmatterLocale
  }

  if (isLocale(firstSegment)) {
    return firstSegment
  }

  return defaultLocale
}

const blogSlug = (doc) => {
  const rawSlug = rawBlogSlug(doc)
  const [firstSegment, ...rest] = rawSlug.split('/')

  if (isLocale(firstSegment) && rest.length > 0) {
    return rest.join('/')
  }

  return rawSlug
}

const blogPath = (doc) => `${blogLocale(doc)}/${blogSlug(doc)}`

const blogComputedFields: ComputedFields = {
  readingTime: { type: 'json', resolve: (doc) => readingTime(doc.body.raw) },
  slug: {
    type: 'string',
    resolve: (doc) => blogSlug(doc),
  },
  locale: {
    type: 'string',
    resolve: (doc) => blogLocale(doc),
  },
  path: {
    type: 'string',
    resolve: (doc) => blogPath(doc),
  },
  filePath: {
    type: 'string',
    resolve: (doc) => doc._raw.sourceFilePath,
  },
  gitUpdatedAt: {
    type: 'string',
    resolve: (doc) => {
      const history = getPostGitHistory(getRepoSourceFilePath(doc))
      return history[0]?.committedAt || toIsoDate(doc.lastmod) || toIsoDate(doc.date)
    },
  },
  gitCommits: {
    type: 'json',
    resolve: (doc) => getPostGitHistory(getRepoSourceFilePath(doc)).slice(0, 6),
  },
  gitCommitCount: {
    type: 'number',
    resolve: (doc) => getPostGitHistory(getRepoSourceFilePath(doc)).length,
  },
  githubUrl: {
    type: 'string',
    resolve: (doc) => {
      const filePath = getRepoSourceFilePath(doc)
      const latestCommit = getPostGitHistory(filePath)[0]
      return getFileUrl(filePath, latestCommit?.hash || 'HEAD')
    },
  },
  toc: { type: 'json', resolve: (doc) => extractTocHeadings(doc.body.raw) },
}

export const Blog = defineDocumentType(() => ({
  name: 'Blog',
  filePathPattern: 'blog/**/*.{md,mdx}',
  contentType: 'mdx',
  fields: {
    title: { type: 'string', required: true },
    date: { type: 'date', required: true },
    categories: { type: 'list', of: { type: 'string' }, default: [] },
    tags: { type: 'list', of: { type: 'string' }, default: [] },
    lastmod: { type: 'date' },
    draft: { type: 'boolean' },
    summary: { type: 'string' },
    language: { type: 'string' },
    translationKey: { type: 'string' },
    image: { type: 'string' },
    images: { type: 'json' },
    authors: { type: 'list', of: { type: 'string' } },
    layout: { type: 'string' },
    canonicalUrl: { type: 'string' },
  },
  computedFields: {
    ...blogComputedFields,
    structuredData: {
      type: 'json',
      resolve: (doc) => {
        const url = absoluteSiteUrl(siteMetadata.siteUrl, blogPath(doc))
        const gitUpdatedAt = getPostGitHistory(getRepoSourceFilePath(doc))[0]?.committedAt

        return {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: doc.title,
          datePublished: doc.date,
          dateModified: gitUpdatedAt || doc.lastmod || doc.date,
          description: doc.summary,
          articleSection: doc.categories,
          keywords: doc.tags,
          image: getPostImageUrls({
            image: doc.image,
            images: doc.images,
            fallback: siteMetadata.socialBanner,
            siteUrl: siteMetadata.siteUrl,
          }),
          url,
          mainEntityOfPage: url,
        }
      },
    },
  },
}))

export const Authors = defineDocumentType(() => ({
  name: 'Authors',
  filePathPattern: 'authors/**/*.mdx',
  contentType: 'mdx',
  fields: {
    name: { type: 'string', required: true },
    avatar: { type: 'string' },
    occupation: { type: 'string' },
    company: { type: 'string' },
    email: { type: 'string' },
    x: { type: 'string' },
    telegram: { type: 'string' },
    github: { type: 'string' },
    layout: { type: 'string' },
  },
  computedFields,
}))

export default makeSource({
  contentDirPath: 'data',
  documentTypes: [Blog, Authors],
  mdx: {
    cwd: process.cwd(),
    remarkPlugins: [remarkGfm, remarkTradingViewWidgets, remarkIconShortcodes, remarkGitHubEmbeds],
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'prepend',
          headingProperties: {
            className: ['content-header'],
          },
          content: icon,
        },
      ],
      rehypeCodeSourceMetadata,
      [rehypePrettyCode, rehypePrettyCodeOptions],
      rehypeCodeLineMetadata,
      rehypePresetMinify,
    ],
  },
})
