import JsonLd from '@/components/JsonLd'
import { Metadata } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { notFound } from 'next/navigation'
import { getPostImageUrls } from '@/lib/postImages'
import {
  getAuthorDetails,
  getLocalizedPostParams,
  getPostBySlug,
  getPostPageData,
} from '@/lib/content/posts'
import { isLocale, localeConfig } from '@/lib/i18n'
import { getPostModifiedDate, getPostPublishedDate } from '@/lib/postDates'
import { localizedPostAlternates } from '@/lib/seo/alternates'
import { createArticleJsonLd } from '@/lib/structuredData'
import { absoluteSiteUrl } from '@/lib/urls'
import PostLayout from '@/layouts/PostLayout'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; slug: string[] }>
}): Promise<Metadata | undefined> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return
  }

  const slug = decodeURI(params.slug.join('/'))
  const post = getPostBySlug(params.locale, slug)
  if (!post) {
    return
  }
  const authorDetails = getAuthorDetails(post.authors || ['default'])

  const publishedAt = new Date(getPostPublishedDate(post)).toISOString()
  const modifiedAt = new Date(getPostModifiedDate(post)).toISOString()
  const authors = authorDetails.map((author) => author.name)
  const postUrl = absoluteSiteUrl(siteMetadata.siteUrl, post.path)
  const canonicalUrl = post.canonicalUrl || postUrl
  const imageUrls = getPostImageUrls({
    image: post.image,
    images: post.images,
    fallback: siteMetadata.socialBanner,
    siteUrl: siteMetadata.siteUrl,
  })
  const ogImages = imageUrls.map((url) => ({ url, alt: post.title }))
  const languages = localizedPostAlternates(siteMetadata.siteUrl, post).languages

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
  return getLocalizedPostParams()
}

export default async function Page(props: { params: Promise<{ locale: string; slug: string[] }> }) {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const slug = decodeURI(params.slug.join('/'))
  const pageData = getPostPageData(params.locale, slug)

  if (!pageData) {
    return notFound()
  }

  const { post, authorDetails, previousPost, nextPost, toc, contentTree } = pageData
  const jsonLd = createArticleJsonLd({
    post,
    locale: params.locale,
    authors: authorDetails,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <PostLayout
        post={post}
        authorDetails={authorDetails}
        previousPost={previousPost}
        nextPost={nextPost}
        toc={toc}
        contentTree={contentTree}
        locale={params.locale}
      />
    </>
  )
}
