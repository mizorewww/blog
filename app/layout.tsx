import 'css/tailwind.css'

import type { Viewport } from 'next'
import Analytics from '@/components/Analytics'
import AppShell from '@/components/AppShell'
import SpeculationRules from '@/components/SpeculationRules'
import siteMetadata from '@/data/siteMetadata'
import { defaultLocale, localeConfig } from '@/lib/i18n'
import LocalizedHtml from './localized-html'
import { ThemeProviders } from './theme-providers'

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fff' },
    { media: '(prefers-color-scheme: dark)', color: '#000' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={localeConfig[defaultLocale].htmlLang} suppressHydrationWarning>
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
        <LocalizedHtml />
        <ThemeProviders>
          <Analytics config={siteMetadata.analytics} />
          <AppShell>{children}</AppShell>
        </ThemeProviders>
      </body>
    </html>
  )
}
