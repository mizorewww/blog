'use client'

import ListLayout from '@/layouts/ListLayoutWithTags'
import type { BlogListPost } from '@/lib/listPosts'
import { defaultLocale, type Locale, ui } from '@/lib/i18n'

export default function Home({
  posts,
  locale = defaultLocale,
}: {
  posts: BlogListPost[]
  locale?: Locale
}) {
  return <ListLayout posts={posts} title={ui[locale].latest} locale={locale} />
}
