import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import siteMetadata from '../data/siteMetadata.ts'
import { allBlogs } from '../.contentlayer/generated/index.mjs'
import { getPostLocale } from '../lib/blog.ts'
import { sortPosts } from '../lib/contentlayer.ts'
import { countTerms, getPostsByTerm } from '../lib/content/terms.ts'
import { defaultLocale } from '../lib/i18n.ts'
import { absoluteSiteUrl } from '../lib/urls.ts'

/**
 * @typedef {Object} RssPost
 * @property {string} path
 * @property {string} title
 * @property {string | null} [summary]
 * @property {string} date
 * @property {string[]} [tags]
 * @property {string[]} [categories]
 * @property {boolean} [draft]
 * @property {string} [locale]
 * @property {string} [language]
 */
/**
 * @typedef {Object} RssConfig
 * @property {string} title
 * @property {string} siteUrl
 * @property {string} description
 * @property {string} language
 * @property {string} email
 * @property {string} author
 */
const outputFolder = 'out'
/** @type {Record<string, string>} */
const xmlEscapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}

/**
 * @param {string} value - value to escape
 * @returns {string}
 */
function escape(value) {
  return String(value).replace(/[&<>'"]/g, (match) => xmlEscapeMap[match])
}

/**
 * @param {RssPost[]} posts - posts to scan for tag slugs
 * @returns {string[]}
 */
function getTagSlugs(posts) {
  return Object.keys(countTerms(posts, 'tags'))
}

/**
 * @param {RssConfig} config - site metadata used for feed metadata
 * @param {RssPost} post - post to render
 * @returns {string}
 */
const generateRssItem = (config, post) => `
  <item>
    <guid>${absoluteSiteUrl(config.siteUrl, post.path)}</guid>
    <title>${escape(post.title)}</title>
    <link>${absoluteSiteUrl(config.siteUrl, post.path)}</link>
    ${post.summary ? `<description>${escape(post.summary)}</description>` : ''}
    <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    <author>${config.email} (${config.author})</author>
    ${post.tags ? post.tags.map((tag) => `<category>${escape(tag)}</category>`).join('') : ''}
  </item>
`

/**
 * @param {RssConfig} config - site metadata used for feed metadata
 * @param {RssPost[]} posts - posts to render
 * @param {string} [page] - feed filename
 * @returns {string}
 */
const generateRss = (config, posts, page = 'feed.xml') => `
  <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
      <title>${escape(config.title)}</title>
      <link>${config.siteUrl}</link>
      <description>${escape(config.description)}</description>
      <language>${config.language}</language>
      <managingEditor>${config.email} (${config.author})</managingEditor>
      <webMaster>${config.email} (${config.author})</webMaster>
      <lastBuildDate>${new Date(posts[0].date).toUTCString()}</lastBuildDate>
      <atom:link href="${config.siteUrl}/${page}" rel="self" type="application/rss+xml"/>
      ${posts.map((post) => generateRssItem(config, post)).join('')}
    </channel>
  </rss>
`

/**
 * @param {RssConfig} config - site metadata used for feed metadata
 * @param {RssPost[]} allBlogs - all posts to filter and render
 * @param {string} [page] - feed filename
 * @returns {Promise<void>}
 */
async function generateRSS(config, allBlogs, page = 'feed.xml') {
  const publishPosts = sortPosts(allBlogs.filter((post) => post.draft !== true))

  if (publishPosts.length === 0) {
    return
  }

  const rss = generateRss(config, publishPosts)
  writeFileSync(`./${outputFolder}/${page}`, rss)

  /**
   * @param {RssPost[]} posts - posts to generate tag feeds for
   * @param {string} routePrefix - route prefix for tag feeds
   */
  const generateTagFeeds = (posts, routePrefix) => {
    for (const tag of getTagSlugs(posts)) {
      const filteredPosts = getPostsByTerm(posts, 'tags', tag)
      const rss = generateRss(config, filteredPosts, `${routePrefix}/${tag}/${page}`)
      const rssPath = path.join(outputFolder, routePrefix, tag)
      mkdirSync(rssPath, { recursive: true })
      writeFileSync(path.join(rssPath, page), rss)
    }
  }

  generateTagFeeds(
    publishPosts.filter((post) => getPostLocale(post) === defaultLocale),
    'tags'
  )

  for (const locale of new Set(publishPosts.map(getPostLocale))) {
    const localePosts = publishPosts.filter((post) => getPostLocale(post) === locale)
    if (localePosts.length > 0) {
      generateTagFeeds(localePosts, `${locale}/tags`)
    }
  }
}

const rss = async () => {
  await generateRSS(siteMetadata, allBlogs)
  console.log('RSS feed generated...')
}
export default rss
