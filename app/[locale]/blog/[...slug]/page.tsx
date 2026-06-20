import { allBlogs, allAuthors } from 'contentlayer/generated'
import type { Authors } from 'contentlayer/generated'
import { Metadata } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { notFound } from 'next/navigation'
import { getPostImageUrls } from '@/lib/postImages'
import { sortPosts, coreContent, allCoreContent } from '@/lib/contentlayer'
import {
  getCategoryCounts,
  getPostByLocaleAndSlug,
  getPostsByLocale,
  getTagCounts,
} from '@/lib/blog'
import { isLocale, localeConfig, locales, localizePath, ui } from '@/lib/i18n'
import ListLayout from '@/layouts/ListLayoutWithTags'
import { toListPosts } from '@/lib/listPosts'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; slug: string[] }>
}): Promise<Metadata | undefined> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return
  }

  const slug = decodeURI(params.slug.join('/'))
  const post = getPostByLocaleAndSlug(allBlogs, params.locale, slug)
  const authorList = post?.authors || ['default']
  const authorDetails = authorList.map((author) => {
    const authorResults = allAuthors.find((p) => p.slug === author)
    return coreContent(authorResults as Authors)
  })
  if (!post) {
    return
  }

  const publishedAt = new Date(post.date).toISOString()
  const modifiedAt = new Date(post.lastmod || post.date).toISOString()
  const authors = authorDetails.map((author) => author.name)
  const postUrl = new URL(`/${post.path}`, siteMetadata.siteUrl).toString()
  const canonicalUrl = post.canonicalUrl || postUrl
  const imageUrls = getPostImageUrls({
    image: post.image,
    images: post.images,
    fallback: siteMetadata.socialBanner,
    siteUrl: siteMetadata.siteUrl,
  })
  const ogImages = imageUrls.map((url) => ({ url, alt: post.title }))
  const languages = locales.reduce<Record<string, string>>((alternates, locale) => {
    const alternatePost = getPostByLocaleAndSlug(allBlogs, locale, slug)

    if (alternatePost) {
      alternates[localeConfig[locale].htmlLang] = localizePath(`/blog/${slug}`, locale)
    }

    return alternates
  }, {})

  return {
    title: post.title,
    description: post.summary,
    authors: authors.map((name) => ({ name })),
    keywords: [...(post.categories || []), ...(post.tags || [])],
    category: post.categories?.[0],
    alternates: {
      canonical: canonicalUrl,
      languages,
    },
    openGraph: {
      title: post.title,
      description: post.summary,
      siteName: siteMetadata.title,
      locale: localeConfig[params.locale].htmlLang.replace('-', '_'),
      type: 'article',
      publishedTime: publishedAt,
      modifiedTime: modifiedAt,
      url: canonicalUrl,
      images: ogImages,
      authors: authors.length > 0 ? authors : [siteMetadata.author],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.summary,
      images: imageUrls,
    },
  }
}

export const generateStaticParams = async () => {
  return locales.flatMap((locale) =>
    getPostsByLocale(allBlogs, locale).map((post) => ({
      locale,
      slug: post.slug.split('/').map((name) => decodeURI(name)),
    }))
  )
}

export default async function Page(props: { params: Promise<{ locale: string; slug: string[] }> }) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const slug = decodeURI(params.slug.join('/'))
  const localeBlogs = getPostsByLocale(allBlogs, params.locale)
  const sortedCoreContents = allCoreContent(sortPosts(localeBlogs))
  const postIndex = sortedCoreContents.findIndex((post) => post.slug === slug)
  if (postIndex === -1) {
    return notFound()
  }

  const post = getPostByLocaleAndSlug(allBlogs, params.locale, slug)

  if (!post) {
    return notFound()
  }

  const authorList = post?.authors || ['default']
  const authorDetails = authorList.map((author) => {
    const authorResults = allAuthors.find((p) => p.slug === author)
    return coreContent(authorResults as Authors)
  })
  const jsonLd = {
    ...post.structuredData,
    articleSection: post.categories,
    keywords: post.tags,
    author: authorDetails.map((author) => ({
      '@type': 'Person',
      name: author.name,
    })),
  }
  const posts = toListPosts(sortPosts(localeBlogs))

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ListLayout
        posts={posts}
        title={ui[params.locale].allPosts}
        locale={params.locale}
        categoryCounts={getCategoryCounts(localeBlogs)}
        tagCounts={getTagCounts(localeBlogs)}
        initialExpandedPath={post.path}
      />
    </>
  )
}
