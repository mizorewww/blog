import type { Authors, Blog } from 'contentlayer/generated'
import type { CoreContent } from '@/lib/contentlayer'
import siteMetadata from '@/data/siteMetadata'
import { localeConfig, type Locale } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { getPostImageUrls } from '@/lib/postImages'
import { getPostModifiedDate } from '@/lib/postDates'
import { absoluteSiteUrl } from '@/lib/urls'

type JsonLdNode = Record<string, unknown>

type CollectionItem = {
  name: string
  url: string
  description?: string | null
}

const siteUrl = absoluteSiteUrl(siteMetadata.siteUrl)
const websiteId = `${siteUrl}#website`
const publisherId = `${siteUrl}#publisher`

function authorPersonId(author?: CoreContent<Authors>) {
  return author?.slug ? `${siteUrl}/authors/${author.slug}#person` : publisherId
}

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

function createPublisherNode(): JsonLdNode {
  return compactObject({
    '@type': 'Person',
    '@id': publisherId,
    name: siteMetadata.author,
    url: siteUrl,
    email: siteMetadata.email,
  })
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
    '@id': authorPersonId(author),
    name: author?.name || siteMetadata.author,
    url: siteUrl,
    email: author?.email || siteMetadata.email,
    image,
    sameAs,
  })
}

function dedupeNodes(nodes: JsonLdNode[]): JsonLdNode[] {
  const seen = new Set<string>()

  return nodes.filter((node) => {
    const id = node['@id']

    if (typeof id !== 'string' || seen.has(id)) {
      return false
    }

    seen.add(id)
    return true
  })
}

function createBreadcrumbNode(url: string, items: { name: string; item: string }[]): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: items.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  }
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
  const authorRefs =
    authors.length > 0
      ? authors.map((author) => ({ '@id': authorPersonId(author) }))
      : [{ '@id': publisherId }]
  const breadcrumb = createBreadcrumbNode(url, [
    { name: siteMetadata.title, item: siteUrl },
    { name: post.title, item: url },
  ])

  return {
    '@context': 'https://schema.org',
    '@graph': dedupeNodes([
      createWebsiteNode(),
      createPublisherNode(),
      ...authors.map(createPersonNode),
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
        dateModified: dateToIso(getPostModifiedDate(post)),
        breadcrumb: { '@id': `${url}#breadcrumb` },
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
        dateModified: dateToIso(getPostModifiedDate(post)),
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
      breadcrumb,
    ]),
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
  const breadcrumb = createBreadcrumbNode(url, [
    { name: siteMetadata.title, item: siteUrl },
    { name: title, item: url },
  ])

  return {
    '@context': 'https://schema.org',
    '@graph': dedupeNodes([
      createWebsiteNode(),
      createPublisherNode(),
      compactObject({
        '@type': 'CollectionPage',
        '@id': pageId,
        url,
        name: title,
        description,
        inLanguage: localeConfig[locale].htmlLang,
        isPartOf: { '@id': websiteId },
        mainEntity: { '@id': itemListId },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      }),
      {
        '@type': 'ItemList',
        '@id': itemListId,
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        numberOfItems: posts.length,
        itemListElement: posts.map(createPostListItem),
      },
      breadcrumb,
    ]),
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
  const breadcrumb = createBreadcrumbNode(url, [
    { name: siteMetadata.title, item: siteUrl },
    { name: title, item: url },
  ])

  return {
    '@context': 'https://schema.org',
    '@graph': dedupeNodes([
      createWebsiteNode(),
      createPublisherNode(),
      compactObject({
        '@type': 'CollectionPage',
        '@id': pageId,
        url,
        name: title,
        description,
        inLanguage: localeConfig[locale].htmlLang,
        isPartOf: { '@id': websiteId },
        mainEntity: createCollectionItemList(items),
        breadcrumb: { '@id': `${url}#breadcrumb` },
      }),
      breadcrumb,
    ]),
  }
}
