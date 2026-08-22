import ListLayout from '@/layouts/ListLayoutWithTags'
import type { ContentTreeNode } from '@/lib/content/contentTree'
import type { BlogListPost } from '@/lib/listPosts'
import { defaultLocale, type Locale, ui } from '@/lib/i18n'

export default function Home({
  posts,
  contentTree,
  locale = defaultLocale,
}: {
  posts: BlogListPost[]
  contentTree: ContentTreeNode[]
  locale?: Locale
}) {
  return (
    <ListLayout posts={posts} contentTree={contentTree} title={ui[locale].latest} locale={locale} />
  )
}
