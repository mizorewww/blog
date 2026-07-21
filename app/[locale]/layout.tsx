import type { Metadata } from 'next'
import siteMetadata from '@/data/siteMetadata'
import { defaultLocale, isLocale, locales } from '@/lib/i18n'
import { genPageMetadata } from '../seo'

type LocaleLayoutProps = {
  children: React.ReactNode
}

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const resolvedLocale = isLocale(locale) ? locale : defaultLocale
  const base = genPageMetadata({
    title: siteMetadata.title,
    description: siteMetadata.description,
    locale: resolvedLocale,
  })

  return {
    ...base,
    metadataBase: new URL(siteMetadata.siteUrl),
    title: {
      default: siteMetadata.title,
      template: `%s | ${siteMetadata.title}`,
    },
    openGraph: {
      ...base.openGraph,
      title: siteMetadata.title,
    },
    twitter: {
      ...base.twitter,
      title: siteMetadata.title,
    },
    alternates: {
      canonical: './',
      types: {
        'application/rss+xml': `${siteMetadata.siteUrl}/feed.xml`,
      },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

export default function LocaleLayout({ children }: LocaleLayoutProps) {
  return children
}
