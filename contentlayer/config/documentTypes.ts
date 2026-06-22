import { defineDocumentType } from 'contentlayer2/source-files'
import siteMetadata from '../../data/siteMetadata'
import { getPostImageUrls } from '../../lib/postImages'
import { absoluteSiteUrl } from '../../lib/urls'
import { blogComputedFields, blogPath, computedFields, getBlogGitUpdatedAt } from './computedFields'

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
        const gitUpdatedAt = getBlogGitUpdatedAt(doc)

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
