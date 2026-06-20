import { defineDocumentType, ComputedFields, makeSource } from 'contentlayer2/source-files'
import readingTime from 'reading-time'
// Remark packages
import remarkGfm from 'remark-gfm'
// Rehype packages
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePresetMinify from 'rehype-preset-minify'
import rehypePrettyCode from 'rehype-pretty-code'
import siteMetadata from './data/siteMetadata'
import { getPostImageUrls } from './lib/postImages'
import { defaultLocale, isLocale } from './lib/i18n'
import { extractTocHeadings } from './lib/toc'

const rehypePrettyCodeOptions = {
  theme: {
    light: 'github-light',
    dark: 'github-dark-dimmed',
  },
  keepBackground: false,
  defaultLang: {
    block: 'plaintext',
    inline: 'plaintext',
  },
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
  toc: { type: 'json', resolve: (doc) => extractTocHeadings(doc.body.raw) },
}

export const Blog = defineDocumentType(() => ({
  name: 'Blog',
  filePathPattern: 'blog/**/*.mdx',
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
        const url = `${siteMetadata.siteUrl}/${blogPath(doc)}`

        return {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: doc.title,
          datePublished: doc.date,
          dateModified: doc.lastmod || doc.date,
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
    remarkPlugins: [remarkGfm],
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
      [rehypePrettyCode, rehypePrettyCodeOptions],
      rehypePresetMinify,
    ],
  },
})
