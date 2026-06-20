import type { Authors, Blog } from 'contentlayer/generated'
import type { CoreContent } from '@/lib/contentlayer'
import siteMetadata from '@/data/siteMetadata'
import { localeConfig, type Locale } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { getPostImageUrls } from '@/lib/postImages'
import { absoluteSiteUrl } from '@/lib/urls'

type JsonLdNode = Record<string, unknown>

type CollectionItem = {
  name: string
  url: string
  description?: string | null
}

const siteUrl = absoluteSiteUrl(siteMetadata.siteUrl)
const websiteId = `${siteUrl}#website`
const publisherId = `${siteUrl}#author`

function compactObject<T extends JsonLdNode>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => {
      if (Array.isArray(fieldValue)) return fieldValue.length > 0
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== ''
    })
  ) as T
}

function dateToIso(date: string | undefined) {
  return date ? new Date(date).toISOString() : undefined
}

function createWebsiteNode(): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': websiteId,
    url: siteUrl,
    name: siteMetadata.title,
    description: siteMetadata.description,
    inLanguage: siteMetadata.language,
    publisher: { '@id': publisherId },
  }
}

function createPersonNode(author?: CoreContent<Authors>): JsonLdNode {
  const sameAs = [author?.github, author?.x, author?.telegram].filter(Boolean)
  const image = author?.avatar
    ? getPostImageUrls({
        image: author.avatar,
        fallback: siteMetadata.socialBanner,
        siteUrl: siteMetadata.siteUrl,
      })[0]
    : undefined

  return compactObject({
    '@type': 'Person',
    '@id': publisherId,
    name: author?.name || siteMetadata.author,
    url: siteUrl,
    email: author?.email || siteMetadata.email,
    image,
    sameAs,
  })
}

function postUrl(post: Pick<BlogListPost, 'path'>) {
  return absoluteSiteUrl(siteMetadata.siteUrl, post.path)
}

function createPostListItem(post: BlogListPost, index: number): JsonLdNode {
  const url = postUrl(post)

  return compactObject({
    '@type': 'ListItem',
    position: index + 1,
    url,
    name: post.title,
    item: compactObject({
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      url,
      headline: post.title,
      description: post.summary,
      datePublished: dateToIso(post.date),
    }),
  })
}

function createCollectionItemList(items: CollectionItem[]): JsonLdNode {
  return {
    '@type': 'ItemList',
    itemListElement: items.map((item, index) =>
      compactObject({
        '@type': 'ListItem',
        position: index + 1,
        url: item.url,
        name: item.name,
        description: item.description,
      })
    ),
    numberOfItems: items.length,
  }
}

export function createArticleJsonLd({
  post,
  locale,
  authors,
}: {
  post: Blog
  locale: Locale
  authors: CoreContent<Authors>[]
}) {
  const url = post.canonicalUrl || postUrl(post)
  const articleId = `${url}#article`
  const pageId = `${url}#webpage`
  const imageUrls = getPostImageUrls({
    image: post.image,
    images: post.images,
    fallback: siteMetadata.socialBanner,
    siteUrl: siteMetadata.siteUrl,
  })
  const authorRefs = authors.length > 0 ? authors.map(() => ({ '@id': publisherId })) : undefined
  const primaryAuthor = authors[0]

  return {
    '@context': 'https://schema.org',
    '@graph': [
      createWebsiteNode(),
      createPersonNode(primaryAuthor),
      compactObject({
        '@type': 'WebPage',
        '@id': pageId,
        url,
        name: post.title,
        description: post.summary,
        inLanguage: localeConfig[locale].htmlLang,
        isPartOf: { '@id': websiteId },
        mainEntity: { '@id': articleId },
        datePublished: dateToIso(post.date),
        dateModified: dateToIso(post.lastmod || post.date),
      }),
      compactObject({
        '@type': 'BlogPosting',
        '@id': articleId,
        url,
        mainEntityOfPage: { '@id': pageId },
        isPartOf: { '@id': websiteId },
        headline: post.title,
        description: post.summary,
        inLanguage: localeConfig[locale].htmlLang,
        datePublished: dateToIso(post.date),
        dateModified: dateToIso(post.lastmod || post.date),
        author: authorRefs,
        publisher: { '@id': publisherId },
        image: imageUrls.map((imageUrl) => ({
          '@type': 'ImageObject',
          url: imageUrl,
        })),
        articleSection: post.categories,
        keywords: post.tags,
        wordCount: (post.readingTime as { words?: number } | undefined)?.words,
      }),
    ],
  }
}

export function createPostCollectionJsonLd({
  title,
  description,
  url,
  locale,
  posts,
}: {
  title: string
  description?: string
  url: string
  locale: Locale
  posts: BlogListPost[]
}) {
  const pageId = `${url}#webpage`
  const itemListId = `${url}#itemlist`

  return {
    '@context': 'https://schema.org',
    '@graph': [
      createWebsiteNode(),
      createPersonNode(),
      compactObject({
        '@type': 'CollectionPage',
        '@id': pageId,
        url,
        name: title,
        description,
        inLanguage: localeConfig[locale].htmlLang,
        isPartOf: { '@id': websiteId },
        mainEntity: { '@id': itemListId },
      }),
      {
        '@type': 'ItemList',
        '@id': itemListId,
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        numberOfItems: posts.length,
        itemListElement: posts.map(createPostListItem),
      },
    ],
  }
}

export function createTermCollectionJsonLd({
  title,
  description,
  url,
  locale,
  items,
}: {
  title: string
  description?: string
  url: string
  locale: Locale
  items: CollectionItem[]
}) {
  const pageId = `${url}#webpage`

  return {
    '@context': 'https://schema.org',
    '@graph': [
      createWebsiteNode(),
      createPersonNode(),
      compactObject({
        '@type': 'CollectionPage',
        '@id': pageId,
        url,
        name: title,
        description,
        inLanguage: localeConfig[locale].htmlLang,
        isPartOf: { '@id': websiteId },
        mainEntity: createCollectionItemList(items),
      }),
    ],
  }
}
