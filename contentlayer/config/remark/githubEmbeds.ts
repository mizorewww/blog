import { readFileSync } from 'node:fs'
import { encodeGitHubPath, siteRepoPath } from '../gitHistory'
import { getGitOutput } from '../../../scripts/lib/git-exec.mjs'
import type { MdastNode } from '../types'
import { parseEmbedAttributes } from './mdxNodes'

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

const githubEmbedPattern = /^::github-(code|diff)\s+(.+)$/
const defaultGitHubRepo = siteRepoPath

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
  const attrs = parseEmbedAttributes<GitHubEmbedAttrs>(attrSource)

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

export function remarkGitHubEmbeds() {
  return async (tree: MdastNode) => transformGitHubEmbeds(tree)
}
