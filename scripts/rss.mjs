import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { slug } from 'github-slugger'
import siteMetadata from '../data/siteMetadata.js'
import { allBlogs } from '../.contentlayer/generated/index.mjs'

const outputFolder = 'out'
const defaultLocale = 'zh'
const xmlEscapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}

function escape(value) {
  return String(value).replace(/[&<>'"]/g, (match) => xmlEscapeMap[match])
}

function absoluteSiteUrl(siteUrl, route = '') {
  const normalizedRoute = route ? `/${route.replace(/^\/+/, '')}` : '/'
  const url = new URL(normalizedRoute, siteUrl).toString()

  return url.endsWith('/') ? url : `${url}/`
}

function sortPosts(posts) {
  return [...posts].sort((first, second) => new Date(second.date) - new Date(first.date))
}

function getPostLocale(post) {
  return post.locale || post.language || defaultLocale
}

function getTagSlugs(posts) {
  const tagSlugs = new Set()

  posts.forEach((post) => {
    post.tags?.forEach((tag) => tagSlugs.add(slug(tag)))
  })

  return Array.from(tagSlugs)
}

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

async function generateRSS(config, allBlogs, page = 'feed.xml') {
  const publishPosts = sortPosts(allBlogs.filter((post) => post.draft !== true))

  if (publishPosts.length === 0) {
    return
  }

  const rss = generateRss(config, publishPosts)
  writeFileSync(`./${outputFolder}/${page}`, rss)

  const generateTagFeeds = (posts, routePrefix) => {
    for (const tag of getTagSlugs(posts)) {
      const filteredPosts = posts.filter((post) =>
        post.tags?.map((postTag) => slug(postTag)).includes(tag)
      )
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

const rss = () => {
  generateRSS(siteMetadata, allBlogs)
  console.log('RSS feed generated...')
}
export default rss
