import ProfileSidebar from '@/components/ProfileSidebar'
import UtilitySidebar from '@/components/UtilitySidebar'
import type { CountMap } from '@/lib/content/terms'
import type { Locale } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import type { ReactNode } from 'react'

export default function BlogFrame({
  posts,
  categoryCounts,
  tagCounts,
  locale,
  dateLocale,
  children,
}: {
  posts: BlogListPost[]
  categoryCounts: CountMap
  tagCounts: CountMap
  locale: Locale
  dateLocale: string
  children: ReactNode
}) {
  return (
    <div className="blog-frame mx-auto grid w-full gap-y-6 px-3 pt-4 pb-14 sm:px-5 sm:pt-6 lg:px-0">
      <div className="blog-main-column">{children}</div>
      <ProfileSidebar
        posts={posts}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
        locale={locale}
      />
      <UtilitySidebar posts={posts} dateLocale={dateLocale} locale={locale} />
    </div>
  )
}
