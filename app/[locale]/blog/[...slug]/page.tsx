import { components } from '@/components/MDXComponents'
import { MDXLayoutRenderer } from 'pliny/mdx-components'
import { sortPosts, coreContent, allCoreContent } from 'pliny/utils/contentlayer'
import { allBlogs, allAuthors } from 'contentlayer/generated'
import type { Authors, Blog } from 'contentlayer/generated'
import PostSimple from '@/layouts/PostSimple'
import PostLayout from '@/layouts/PostLayout'
import PostBanner from '@/layouts/PostBanner'
import { Metadata } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { notFound } from 'next/navigation'
import { getPostImageUrls } from '@/lib/postImages'
import { getPostByLocaleAndSlug, getPostsByLocale } from '@/lib/blog'
import { isLocale, localeConfig, locales, localizePath } from '@/lib/i18n'

const defaultLayout = 'PostLayout'
const layouts = {
  PostSimple,
  PostLayout,
  PostBanner,
}

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

  const prev = sortedCoreContents[postIndex + 1]
  const next = sortedCoreContents[postIndex - 1]
  const post = getPostByLocaleAndSlug(allBlogs, params.locale, slug) as Blog
  const authorList = post?.authors || ['default']
  const authorDetails = authorList.map((author) => {
    const authorResults = allAuthors.find((p) => p.slug === author)
    return coreContent(authorResults as Authors)
  })
  const mainContent = coreContent(post)
  const jsonLd = post.structuredData
  jsonLd['author'] = authorDetails.map((author) => {
    return {
      '@type': 'Person',
      name: author.name,
    }
  })

  const Layout = layouts[post.layout || defaultLayout]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Layout content={mainContent} authorDetails={authorDetails} next={next} prev={prev}>
        <MDXLayoutRenderer code={post.body.code} components={components} toc={post.toc} />
      </Layout>
    </>
  )
}
