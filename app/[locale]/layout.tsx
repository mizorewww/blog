import 'css/tailwind.css'

import type { Metadata, Viewport } from 'next'
import Analytics from '@/components/Analytics'
import AppShell from '@/components/AppShell'
import SpeculationRules from '@/components/SpeculationRules'
import siteMetadata from '@/data/siteMetadata'
import { defaultLocale, isLocale, localeConfig, locales } from '@/lib/i18n'
import { genPageMetadata } from '../seo'
import { ThemeProviders } from '../theme-providers'

type LocaleLayoutProps = {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fff' },
    { media: '(prefers-color-scheme: dark)', color: '#000' },
  ],
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

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params
  const htmlLang = isLocale(locale)
    ? localeConfig[locale].htmlLang
    : localeConfig[defaultLocale].htmlLang

  return (
    <html lang={htmlLang} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/static/favicons/apple-touch-icon.png" />
        <link rel="icon" type="image/svg+xml" href="/static/favicons/favicon.svg" />
        <link rel="shortcut icon" href="/static/favicons/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/static/favicons/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/static/favicons/favicon-16x16.png" />
        <link rel="manifest" href="/static/favicons/site.webmanifest" />
        <link rel="mask-icon" href="/static/favicons/safari-pinned-tab.svg" color="#000000" />
        <meta name="msapplication-TileColor" content="#000000" />
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
        <link rel="preconnect" href="https://analytics.umami.is" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://s3.tradingview.com" />
        <SpeculationRules />
      </head>
      <body className="bg-surface-page dark:bg-surface-page-dark min-h-screen overflow-y-scroll font-sans text-slate-900 antialiased dark:text-white/90">
        <ThemeProviders>
          <Analytics config={siteMetadata.analytics} />
          <AppShell>{children}</AppShell>
        </ThemeProviders>
      </body>
    </html>
  )
}
