'use client'

import { motion, useReducedMotion } from 'motion/react'
import Link from '@/components/Link'
import { mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'

export default function PostNavLinks({
  currentPost,
  allPosts,
  locale,
}: {
  currentPost: BlogListPost
  allPosts: BlogListPost[]
  locale: Locale
  dateLocale?: string
}) {
  const labels = ui[locale]
  const shouldReduceMotion = useReducedMotion()
  const index = allPosts.findIndex((post) => post.path === currentPost.path)

  if (index < 0) return null

  const prevPost = index + 1 < allPosts.length ? allPosts[index + 1] : null
  const nextPost = index - 1 >= 0 ? allPosts[index - 1] : null

  if (!prevPost && !nextPost) return null

  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: animataQuickDuration, ease: animataEase, delay: 0.1 }

  return (
    <nav
      aria-label={labels.previousArticle}
      className="not-prose mt-10 flex items-stretch justify-between gap-4 border-t border-slate-200 pt-6 dark:border-white/10"
    >
      {prevPost ? (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition}
          className="flex-1"
        >
          <Link
            href={`/${prevPost.path}/`}
            aria-label={labels.previousPost(prevPost.title)}
            className="group flex flex-col gap-1"
          >
            <span className={`text-xs ${mutedText}`}>← {labels.previousArticle}</span>
            <span className="font-medium text-slate-700 transition-colors duration-200 group-hover:text-sky-700 dark:text-white/80 dark:group-hover:text-sky-300">
              {prevPost.title}
            </span>
          </Link>
        </motion.div>
      ) : (
        <div className="flex-1" />
      )}
      {nextPost ? (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition, delay: shouldReduceMotion ? 0 : 0.16 }}
          className="flex-1 text-right"
        >
          <Link
            href={`/${nextPost.path}/`}
            aria-label={labels.nextPost(nextPost.title)}
            className="group flex flex-col items-end gap-1"
          >
            <span className={`text-xs ${mutedText}`}>{labels.nextArticle} →</span>
            <span className="font-medium text-slate-700 transition-colors duration-200 group-hover:text-sky-700 dark:text-white/80 dark:group-hover:text-sky-300">
              {nextPost.title}
            </span>
          </Link>
        </motion.div>
      ) : (
        <div className="flex-1" />
      )}
    </nav>
  )
}
