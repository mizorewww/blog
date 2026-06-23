import 'css/tailwind.css'

import Analytics from '@/components/Analytics'
import AppShell from '@/components/AppShell'
import SpeculationRules from '@/components/SpeculationRules'
import siteMetadata from '@/data/siteMetadata'
import { ThemeProviders } from './theme-providers'
import { Metadata } from 'next'
import { genPageMetadata } from './seo'

const rootMetadata = genPageMetadata({
  title: siteMetadata.title,
  description: siteMetadata.description,
})

export const metadata: Metadata = {
  ...rootMetadata,
  metadataBase: new URL(siteMetadata.siteUrl),
  title: {
    default: siteMetadata.title,
    template: `%s | ${siteMetadata.title}`,
  },
  openGraph: {
    ...rootMetadata.openGraph,
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
  twitter: {
    ...rootMetadata.twitter,
    title: siteMetadata.title,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={siteMetadata.language} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/static/favicons/apple-touch-icon.png" />
        <link rel="icon" type="image/svg+xml" href="/static/favicons/favicon.svg" />
        <link rel="shortcut icon" href="/static/favicons/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/static/favicons/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/static/favicons/favicon-16x16.png" />
        <link rel="manifest" href="/static/favicons/site.webmanifest" />
        <link rel="mask-icon" href="/static/favicons/safari-pinned-tab.svg" color="#000000" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000" />
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
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
