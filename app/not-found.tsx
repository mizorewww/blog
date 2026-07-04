import Link from '@/components/Link'
import siteMetadata from '@/data/siteMetadata'
import { ui } from '@/lib/i18n'
import 'css/tailwind.css'

export default function NotFound() {
  const labels = ui.zh

  return (
    <html lang={siteMetadata.language}>
      <head>
        <title>404 | {siteMetadata.title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/static/favicons/favicon.svg" />
      </head>
      <body className="bg-surface-page dark:bg-surface-page-dark min-h-screen font-sans text-slate-900 antialiased dark:text-white/90">
        <div className="flex min-h-screen flex-col items-start justify-start px-6 py-12 md:mt-24 md:flex-row md:items-center md:justify-center md:space-x-6">
          <div className="space-x-2 pt-6 pb-8 md:space-y-5">
            <div
              aria-hidden="true"
              className="text-6xl leading-9 font-extrabold tracking-tight text-slate-900 md:border-r-2 md:px-6 md:text-8xl md:leading-14 dark:text-white/90"
            >
              404
            </div>
          </div>
          <div className="max-w-md">
            <h1 className="mb-4 text-xl leading-normal font-bold md:text-2xl">
              {labels.notFoundTitle}
            </h1>
            <p className="mb-8">{labels.notFoundDescription}</p>
            <Link
              href="/"
              className="inline rounded-[8px] border border-transparent bg-sky-700 px-4 py-2 text-sm leading-5 font-medium text-white shadow-xs hover:bg-sky-800"
            >
              {labels.backToHome}
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
