'use client'

import { useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'
import { getLocaleFromPathname, localeConfig } from '@/lib/i18n'

export default function LocalizedHtml() {
  const locale = getLocaleFromPathname(usePathname())
  const htmlLang = localeConfig[locale].htmlLang

  useLayoutEffect(() => {
    document.documentElement.lang = htmlLang
  }, [htmlLang])

  return (
    <script
      data-html-language={htmlLang}
      dangerouslySetInnerHTML={{
        __html: `document.documentElement.lang=${JSON.stringify(htmlLang)}`,
      }}
    />
  )
}
