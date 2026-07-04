import type { Metadata } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { defaultLocale, localeConfig, type Locale } from '@/lib/i18n'
import { getPostImageUrls } from '@/lib/postImages'

type PageSEOProps = Omit<Metadata, 'title' | 'description' | 'openGraph' | 'twitter'> & {
  title: string
  description?: string
  image?: string
  locale?: Locale
  openGraph?: Metadata['openGraph']
  twitter?: Metadata['twitter']
}

export function ogLocale(locale: Locale = defaultLocale) {
  return localeConfig[locale].htmlLang.replace('-', '_')
}

export function genPageMetadata({
  title,
  description,
  image,
  locale,
  ...rest
}: PageSEOProps): Metadata {
  const imageUrls = getPostImageUrls({
    image,
    fallback: siteMetadata.socialBanner,
    siteUrl: siteMetadata.siteUrl,
  })
  const { openGraph, twitter, ...metadata } = rest
  const resolvedLocale = locale || defaultLocale

  return {
    title,
    description: description || siteMetadata.description,
    openGraph: {
      title: `${title} | ${siteMetadata.title}`,
      description: description || siteMetadata.description,
      url: './',
      siteName: siteMetadata.title,
      images: imageUrls,
      locale: ogLocale(resolvedLocale),
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
