import Main from './Main'
import { genPageMetadata } from './seo'
import { getBlogListData } from '@/lib/content/posts'
import { defaultLocale, ui } from '@/lib/i18n'

export const metadata = genPageMetadata({ title: ui[defaultLocale].home })

export default async function Page() {
  const { posts } = getBlogListData(defaultLocale)
  return <Main posts={posts} locale={defaultLocale} />
}
