import { execFileSync } from 'node:child_process'
import siteMetadata from '../../data/siteMetadata'

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

const gitFieldSeparator = '\x1f'
const gitRecordSeparator = '\x1e'
const postGitHistoryCache = new Map<string, PostGitCommit[]>()

export const siteRepo = (siteMetadata.siteRepo || '').replace(/\/+$/, '')
export const siteRepoPath = siteRepo.startsWith('https://github.com/')
  ? siteRepo.replace(/^https:\/\/github\.com\//, '')
  : ''

export function getGitOutput(args: string[]) {
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

function getCurlOutput(args: string[]) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const authArgs = token ? ['-H', `Authorization: Bearer ${token}`] : []

  try {
    return execFileSync('curl', ['--max-time', '10', ...authArgs, ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
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
  return siteRepo ? `${siteRepo}/blob/${ref}/${encodeGitHubPath(filePath)}` : ''
}

export function getRepoSourceFilePath(doc: { _raw: { sourceFilePath: string } }) {
  const sourceFilePath = doc._raw.sourceFilePath.replace(/^\/+/, '')
  return sourceFilePath.startsWith('data/') ? sourceFilePath : `data/${sourceFilePath}`
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

function getGitHubApiCommitHistory(filePath: string): PostGitCommit[] {
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

  const output = getCurlOutput([
    '-fsSL',
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'User-Agent: mizore-blog-contentlayer',
    `https://api.github.com/repos/${getGitHubApiRepoPath(siteRepoPath)}/commits?${params.toString()}`,
  ])

  if (!output) {
    return []
  }

  try {
    const commits = JSON.parse(output) as GitHubCommitApiEntry[]

    if (!Array.isArray(commits)) {
      return []
    }

    return commits
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
  } catch {
    return []
  }
}

export function getPostGitHistory(filePath: string): PostGitCommit[] {
  const cachedHistory = postGitHistoryCache.get(filePath)

  if (cachedHistory) {
    return cachedHistory
  }

  const localHistory = getLocalPostGitHistory(filePath)
  const shouldFetchGitHubHistory = isShallowGitRepository() || localHistory.length <= 1
  const githubHistory = shouldFetchGitHubHistory ? getGitHubApiCommitHistory(filePath) : []
  const history = githubHistory.length > localHistory.length ? githubHistory : localHistory

  postGitHistoryCache.set(filePath, history)

  return history
}
