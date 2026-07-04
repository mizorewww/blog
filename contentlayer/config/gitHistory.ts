import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import siteMetadata from '../../data/siteMetadata'
import { getGitOutput } from '../../scripts/lib/git-exec.mjs'

export type PostGitCommit = {
  hash: string
  shortHash: string
  committedAt: string
  subject: string
  url: string
}

type GitHubCommitApiEntry = {
  commit?: {
    author?: { date?: string }
    committer?: { date?: string }
    message?: string
  }
  html_url?: string
  sha?: string
}

type GitHubApiCache = Record<string, PostGitCommit[]>

const gitFieldSeparator = '\x1f'
const gitRecordSeparator = '\x1e'
const fetchTimeoutMs = 10_000
const fetchRetries = 2
const githubApiCachePath = path.join(process.cwd(), '.contentlayer/cache/github-api.json')
const postGitHistoryCache = new Map<string, Promise<PostGitCommit[]>>()

let githubApiCache: GitHubApiCache | null = null

export const siteRepo = (siteMetadata.siteRepo || '').replace(/\/+$/, '')
export const siteRepoPath = siteRepo.startsWith('https://github.com/')
  ? siteRepo.replace(/^https:\/\/github\.com\//, '')
  : ''

function gitCommandSucceeds(args: string[]) {
  try {
    execFileSync('git', args, {
      cwd: process.cwd(),
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function isShallowGitRepository() {
  return getGitOutput(['rev-parse', '--is-shallow-repository']) === 'true'
}

export function encodeGitHubPath(filePath: string) {
  return filePath.split('/').map(encodeURIComponent).join('/')
}

function getCommitUrl(hash: string) {
  return siteRepo && hash ? `${siteRepo}/commit/${hash}` : ''
}

export function getFileUrl(filePath: string, ref = 'HEAD') {
  const legacyFilePath = getLegacyRepoSourceFilePath(filePath)
  const filePathAtRef =
    legacyFilePath && !gitCommandSucceeds(['cat-file', '-e', `${ref}:${filePath}`])
      ? legacyFilePath
      : filePath

  return siteRepo ? `${siteRepo}/blob/${ref}/${encodeGitHubPath(filePathAtRef)}` : ''
}

export function getRepoSourceFilePath(doc: { _raw: { sourceFilePath: string } }) {
  const sourceFilePath = doc._raw.sourceFilePath.replace(/^\/+/, '')
  return sourceFilePath.startsWith('content/') ? sourceFilePath : `content/${sourceFilePath}`
}

function getLegacyRepoSourceFilePath(filePath: string) {
  if (filePath.startsWith('content/blog/')) {
    return filePath.replace(/^content\/blog\//, 'data/blog/')
  }

  if (filePath.startsWith('content/authors/')) {
    return filePath.replace(/^content\/authors\//, 'data/authors/')
  }

  return ''
}

function getRepoSourceFilePathCandidates(filePath: string) {
  return [...new Set([filePath, getLegacyRepoSourceFilePath(filePath)].filter(Boolean))]
}

function longestHistory(histories: PostGitCommit[][]) {
  return histories.reduce<PostGitCommit[]>(
    (longest, history) => (history.length > longest.length ? history : longest),
    []
  )
}

export function toIsoDate(value: unknown) {
  if (!value) return ''

  const date = new Date(value as string | Date)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function getLocalPostGitHistory(filePath: string): PostGitCommit[] {
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

  return history
}

function getGitHubApiRepoPath(repo: string) {
  return repo.split('/').map(encodeURIComponent).join('/')
}

function getGitHubApiCacheKey(filePath: string, head: string) {
  return `${siteRepoPath}:${head || 'HEAD'}:${filePath}`
}

function readGitHubApiCache() {
  if (githubApiCache) {
    return githubApiCache
  }

  if (!existsSync(githubApiCachePath)) {
    githubApiCache = {}
    return githubApiCache
  }

  try {
    githubApiCache = JSON.parse(readFileSync(githubApiCachePath, 'utf8')) as GitHubApiCache
  } catch {
    githubApiCache = {}
  }

  return githubApiCache
}

function writeGitHubApiCache(cache: GitHubApiCache) {
  mkdirSync(path.dirname(githubApiCachePath), { recursive: true })
  writeFileSync(githubApiCachePath, `${JSON.stringify(cache, null, 2)}\n`)
}

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchGitHubJson(url: string) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mizore-blog-contentlayer',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let lastError: unknown

  for (let attempt = 0; attempt <= fetchRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { headers })

      if (!response.ok) {
        throw new Error(`GitHub API ${response.status} ${response.statusText}`)
      }

      return response.json()
    } catch (error) {
      lastError = error
      if (attempt < fetchRetries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function mapGitHubCommits(commits: unknown): PostGitCommit[] {
  if (!Array.isArray(commits)) {
    return []
  }

  return (commits as GitHubCommitApiEntry[])
    .map((entry) => {
      const hash = entry.sha || ''
      const committedAt = entry.commit?.committer?.date || entry.commit?.author?.date || ''
      const subject = (entry.commit?.message || '').split('\n')[0] || hash

      return {
        hash,
        shortHash: hash.slice(0, 7),
        committedAt,
        subject,
        url: entry.html_url || getCommitUrl(hash),
      }
    })
    .filter((commit) => commit.hash && commit.shortHash && commit.committedAt)
}

async function getGitHubApiCommitHistory(filePath: string): Promise<PostGitCommit[]> {
  if (!siteRepoPath) {
    return []
  }

  const params = new URLSearchParams({
    path: filePath,
    per_page: '100',
  })
  const head = getGitOutput(['rev-parse', 'HEAD'])

  if (head) {
    params.set('sha', head)
  }

  const cache = readGitHubApiCache()
  const cacheKey = getGitHubApiCacheKey(filePath, head)
  const cachedHistory = cache[cacheKey]

  if (cachedHistory) {
    return cachedHistory
  }

  const url = `https://api.github.com/repos/${getGitHubApiRepoPath(siteRepoPath)}/commits?${params.toString()}`

  try {
    const commits = mapGitHubCommits(await fetchGitHubJson(url))
    cache[cacheKey] = commits
    writeGitHubApiCache(cache)
    return commits
  } catch (error) {
    console.warn(
      `Could not fetch GitHub commit history for ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return []
  }
}

async function resolvePostGitHistory(filePath: string): Promise<PostGitCommit[]> {
  const filePaths = getRepoSourceFilePathCandidates(filePath)
  const localHistory = longestHistory(filePaths.map(getLocalPostGitHistory))
  const shouldFetchGitHubHistory = isShallowGitRepository() || localHistory.length <= 1
  const githubHistory = shouldFetchGitHubHistory
    ? longestHistory(await Promise.all(filePaths.map(getGitHubApiCommitHistory)))
    : []

  return githubHistory.length > localHistory.length ? githubHistory : localHistory
}

export function getPostGitHistory(filePath: string): Promise<PostGitCommit[]> {
  const cachedHistory = postGitHistoryCache.get(filePath)

  if (cachedHistory) {
    return cachedHistory
  }

  const history = resolvePostGitHistory(filePath)
  postGitHistoryCache.set(filePath, history)

  return history
}
