import { Metadata } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { getPostImageUrls } from '@/lib/postImages'

interface PageSEOProps {
  title: string
  description?: string
  image?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export function genPageMetadata({ title, description, image, ...rest }: PageSEOProps): Metadata {
  const imageUrls = getPostImageUrls({
    image,
    fallback: siteMetadata.socialBanner,
    siteUrl: siteMetadata.siteUrl,
  })
  const { openGraph, twitter, ...metadata } = rest

  return {
    title,
    description: description || siteMetadata.description,
    openGraph: {
      title: `${title} | ${siteMetadata.title}`,
      description: description || siteMetadata.description,
      url: './',
      siteName: siteMetadata.title,
      images: imageUrls,
      locale: 'en_US',
      type: 'website',
      ...openGraph,
    },
    twitter: {
      title: `${title} | ${siteMetadata.title}`,
      card: 'summary_large_image',
      images: imageUrls,
      ...twitter,
    },
    ...metadata,
  }
}
