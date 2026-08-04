'use client'

import { usePathname } from 'next/navigation'
import Link from '@/components/Link'
import { getLocaleFromPathname, localizePath, ui } from '@/lib/i18n'

export default function NotFoundPage() {
  const locale = getLocaleFromPathname(usePathname())
  const labels = ui[locale]

  return (
    <div className="blog-shell mx-auto flex min-h-[calc(100dvh-72px)] w-full items-start px-4 pt-16 pb-12 sm:px-6 lg:min-h-[calc(100dvh-96px)] lg:items-center lg:py-12">
      <div
        data-not-found-content
        className="flex w-full flex-col items-start justify-start gap-8 md:flex-row md:items-center md:justify-center md:gap-6"
      >
        <div
          data-not-found-code
          aria-hidden="true"
          className="text-7xl leading-none font-extrabold tracking-tight text-slate-900 md:border-r-2 md:px-6 md:text-8xl dark:text-white/90"
        >
          404
        </div>
        <div className="max-w-md">
          <h1 className="mb-4 text-xl leading-normal font-bold md:text-2xl">
            {labels.notFoundTitle}
          </h1>
          <p className="mb-8">{labels.notFoundDescription}</p>
          <Link
            href={localizePath('/', locale)}
            className="inline-flex min-h-11 touch-manipulation items-center rounded-[8px] border border-transparent bg-sky-700 px-4 py-2 text-sm leading-5 font-medium text-white shadow-xs transition-colors duration-200 hover:bg-sky-800"
          >
            {labels.backToHome}
          </Link>
        </div>
      </div>
    </div>
  )
}
