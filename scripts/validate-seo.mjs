import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import siteMetadata from '../data/siteMetadata.ts'
import { allBlogs } from '../.contentlayer/generated/index.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const outDir = path.join(repoRoot, 'out')
const defaultLocale = 'zh'
const locales = ['zh', 'en']
const htmlLang = {
  zh: 'zh-CN',
  en: 'en-US',
}

function fail(message) {
  console.error(`SEO validation failed: ${message}`)
  process.exitCode = 1
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function readOutFile(relativePath) {
  return readFileSync(path.join(outDir, relativePath), 'utf8')
}

function htmlPathForUrl(url) {
  const pathname = new URL(url).pathname

  if (pathname === '/') {
    return path.join(outDir, 'index.html')
  }

  return path.join(outDir, pathname.replace(/^\/+|\/+$/g, ''), 'index.html')
}

function getLocale(post) {
  return locales.includes(post.locale) ? post.locale : post.language || defaultLocale
}

function latestModified(posts) {
  return posts
    .map((post) => post.gitUpdatedAt || post.lastmod || post.date)
    .filter(Boolean)
    .sort((first, second) => new Date(second).getTime() - new Date(first).getTime())[0]
}

function extractAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([:\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])
  )
}

function extractSitemapEntries(sitemap) {
  return [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => {
    const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1]
    const lastmod = entry.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]
    const alternates = [...entry.matchAll(/<xhtml:link\b[^>]*>/g)].map((match) =>
      extractAttributes(match[0])
    )

    return { loc, lastmod, alternates }
  })
}

function extractCanonical(html) {
  return html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
}

function extractJsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(([, json]) => JSON.parse(json))
    .flatMap((data) => (Array.isArray(data?.['@graph']) ? data['@graph'] : [data]))
}

function hasType(nodes, type) {
  return nodes.some((node) => {
    const nodeType = node?.['@type']

    return Array.isArray(nodeType) ? nodeType.includes(type) : nodeType === type
  })
}

function findType(nodes, type) {
  return nodes.find((node) => {
    const nodeType = node?.['@type']

    return Array.isArray(nodeType) ? nodeType.includes(type) : nodeType === type
  })
}

function isArticlePath(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean)

  return (
    segments.length === 2 &&
    locales.includes(segments[0]) &&
    !['categories', 'tags'].includes(segments[1])
  )
}

function postUrl(post) {
  return `${siteMetadata.siteUrl}/${post.path}/`
}

function isLocalizedPath(url) {
  const firstSegment = new URL(url).pathname.split('/').filter(Boolean)[0]

  return locales.includes(firstSegment)
}

const sitemap = readOutFile('sitemap.xml')
const robots = readOutFile('robots.txt')
const redirects = readOutFile('_redirects')
const sitemapEntries = extractSitemapEntries(sitemap)
const sitemapByLoc = new Map(sitemapEntries.map((entry) => [entry.loc, entry]))
const publishedPosts = allBlogs.filter((post) => post.draft !== true)
const expectedSitemapLocs = new Set([
  ...locales.map((locale) => `${siteMetadata.siteUrl}/${locale}/`),
  ...publishedPosts.map(postUrl),
])
const latestAll = latestModified(publishedPosts)
const latestByLocale = Object.fromEntries(
  locales.map((locale) => [
    locale,
    latestModified(publishedPosts.filter((post) => getLocale(post) === locale)) || latestAll,
  ])
)

assert(
  robots.includes(`${siteMetadata.siteUrl}/sitemap.xml`),
  'robots.txt must reference sitemap.xml'
)
assert(
  redirects.includes('/blog/* /zh/:splat 301'),
  '_redirects must preserve legacy /blog/* redirects'
)
assert(redirects.includes('/ /zh/ 301'), '_redirects must send root to the default locale')
assert(
  redirects.includes('/categories/* /zh/categories/:splat 301'),
  '_redirects must send default category routes to the default locale'
)
assert(
  redirects.includes('/tags/* /zh/tags/:splat 301'),
  '_redirects must send default tag routes to the default locale'
)
assert(
  sitemap.includes('xmlns:xhtml='),
  'sitemap must include xhtml namespace for hreflang alternates'
)
assert(
  sitemapEntries.length === expectedSitemapLocs.size,
  'sitemap must contain only locale roots and article URLs'
)

for (const entry of sitemapEntries) {
  assert(entry.loc?.startsWith(siteMetadata.siteUrl), `invalid sitemap loc: ${entry.loc}`)
  assert(expectedSitemapLocs.has(entry.loc), `${entry.loc} must not be included in sitemap`)
  assert(entry.loc?.endsWith('/'), `${entry.loc} must end with /`)
  assert(!entry.loc.includes('/blog/'), `${entry.loc} must not expose legacy /blog/ routes`)
  assert(entry.alternates.length > 0, `${entry.loc} must include hreflang alternates`)

  if (isLocalizedPath(entry.loc)) {
    const locale = new URL(entry.loc).pathname.split('/').filter(Boolean)[0]
    const selfAlternate = entry.alternates.find(
      (alternate) => alternate['hreflang'] === htmlLang[locale]
    )
    assert(selfAlternate?.href === entry.loc, `${entry.loc} must include a self hreflang alternate`)
  }

  const htmlPath = htmlPathForUrl(entry.loc)
  if (!existsSync(htmlPath)) {
    continue
  }

  const html = readFileSync(htmlPath, 'utf8')
  const canonical = extractCanonical(html)
  const nodes = extractJsonLd(html)

  assert(canonical === entry.loc, `${entry.loc} canonical must match sitemap loc`)
  assert(hasType(nodes, 'WebSite'), `${entry.loc} JSON-LD must include WebSite`)

  if (isArticlePath(entry.loc)) {
    const article = findType(nodes, 'BlogPosting')
    const webPage = findType(nodes, 'WebPage')
    assert(article, `${entry.loc} JSON-LD must include BlogPosting`)
    assert(webPage, `${entry.loc} JSON-LD must include WebPage`)
    assert(article?.url === entry.loc, `${entry.loc} BlogPosting.url must match canonical URL`)
    assert(
      article?.['@id'] === `${entry.loc}#article`,
      `${entry.loc} BlogPosting @id must be stable`
    )
  } else {
    assert(hasType(nodes, 'CollectionPage'), `${entry.loc} JSON-LD must include CollectionPage`)
  }
}

for (const locale of locales) {
  const loc = `${siteMetadata.siteUrl}/${locale}/`
  const entry = sitemapByLoc.get(loc)
  assert(
    entry?.lastmod === latestByLocale[locale],
    `${loc} lastmod must match latest ${locale} content update`
  )
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log('SEO validation passed')
