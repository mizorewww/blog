import type { ComputedFields } from 'contentlayer2/source-files'
import readingTime from 'reading-time'
import { defaultLocale, isLocale } from '../../lib/i18n'
import { extractTocHeadings } from '../../lib/toc'
import { getFileUrl, getPostGitHistory, getRepoSourceFilePath, toIsoDate } from './gitHistory'
import { writeMdxModule } from './mdxModules'

type ContentlayerDoc = {
  body?: { code?: string; raw: string }
  date?: string | Date
  language?: string
  lastmod?: string | Date
  _raw: {
    flattenedPath: string
    sourceFilePath: string
  }
}

export const computedFields: ComputedFields = {
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
  mdxModulePath: { type: 'string', resolve: writeMdxModule },
}

const rawBlogSlug = (doc: ContentlayerDoc) => doc._raw.flattenedPath.replace(/^.+?(\/)/, '')

const blogLocale = (doc: ContentlayerDoc) => {
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

const blogSlug = (doc: ContentlayerDoc) => {
  const rawSlug = rawBlogSlug(doc)
  const [firstSegment, ...rest] = rawSlug.split('/')

  if (isLocale(firstSegment) && rest.length > 0) {
    return rest.join('/')
  }

  return rawSlug
}

const blogPath = (doc: ContentlayerDoc) => `${blogLocale(doc)}/${blogSlug(doc)}`

export const blogComputedFields: ComputedFields = {
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
    resolve: async (doc) => {
      const history = await getPostGitHistory(getRepoSourceFilePath(doc))
      return history[0]?.committedAt || toIsoDate(doc.lastmod) || toIsoDate(doc.date)
    },
  },
  gitCommits: {
    type: 'json',
    resolve: async (doc) => (await getPostGitHistory(getRepoSourceFilePath(doc))).slice(0, 6),
  },
  gitCommitCount: {
    type: 'number',
    resolve: async (doc) => (await getPostGitHistory(getRepoSourceFilePath(doc))).length,
  },
  githubUrl: {
    type: 'string',
    resolve: async (doc) => {
      const filePath = getRepoSourceFilePath(doc)
      const latestCommit = (await getPostGitHistory(filePath))[0]
      return getFileUrl(filePath, latestCommit?.hash || 'HEAD')
    },
  },
  toc: { type: 'json', resolve: (doc) => extractTocHeadings(doc.body.raw) },
  mdxModulePath: { type: 'string', resolve: writeMdxModule },
}
