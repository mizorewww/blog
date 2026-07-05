'use client'

import { motion, useReducedMotion } from 'motion/react'
import Link from '@/components/Link'
import { cardClass, mutedText } from '@/components/ui/styles'
import { type Locale, ui } from '@/lib/i18n'
import type { BlogListPost } from '@/lib/listPosts'
import { formatDate } from '@/lib/formatDate'
import Icon from '@/components/Icon'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'

export default function PostNavLinks({
  currentPost,
  allPosts,
  locale,
  dateLocale,
}: {
  currentPost: BlogListPost
  allPosts: BlogListPost[]
  locale: Locale
  dateLocale: string
}) {
  const labels = ui[locale]
  const shouldReduceMotion = useReducedMotion()
  const index = allPosts.findIndex((post) => post.path === currentPost.path)

  if (index < 0) return null

  const prevPost = index + 1 < allPosts.length ? allPosts[index + 1] : null
  const nextPost = index - 1 >= 0 ? allPosts[index - 1] : null

  if (!prevPost && !nextPost) return null

  const itemVariants = {
    hidden: shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: shouldReduceMotion
        ? { duration: 0 }
        : { duration: animataQuickDuration, ease: animataEase },
    },
  }

  return (
    <motion.nav
      aria-label={labels.previousArticle}
      className="not-prose mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2"
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: shouldReduceMotion ? 0 : 0.06 } },
      }}
    >
      {prevPost ? (
        <motion.div variants={itemVariants}>
          <Link
            href={`/${prevPost.path}/`}
            aria-label={labels.previousPost(prevPost.title)}
            className={`${cardClass} group flex flex-col gap-1.5 px-5 py-4 transition-shadow duration-200 hover:shadow-[0_18px_44px_rgba(21,30,43,0.1)] sm:items-start dark:hover:ring-white/20`}
          >
            <span
              className={`flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase ${mutedText}`}
            >
              <Icon
                name="ChevronDown"
                className="h-3.5 w-3.5 rotate-90"
                inlineSpacing={false}
                decorative
              />
              {labels.previousArticle}
            </span>
            <span className="font-medium text-slate-900 group-hover:text-sky-700 dark:text-white/90 dark:group-hover:text-sky-300">
              {prevPost.title}
            </span>
            <time
              dateTime={prevPost.date}
              suppressHydrationWarning
              className={`text-sm ${mutedText}`}
            >
              {formatDate(prevPost.date, dateLocale)}
            </time>
          </Link>
        </motion.div>
      ) : (
        <div className="hidden sm:block" />
      )}
      {nextPost ? (
        <motion.div variants={itemVariants}>
          <Link
            href={`/${nextPost.path}/`}
            aria-label={labels.nextPost(nextPost.title)}
            className={`${cardClass} group flex flex-col gap-1.5 px-5 py-4 text-right transition-shadow duration-200 hover:shadow-[0_18px_44px_rgba(21,30,43,0.1)] sm:items-end dark:hover:ring-white/20`}
          >
            <span
              className={`flex items-center justify-end gap-1.5 text-xs font-medium tracking-wide uppercase ${mutedText}`}
            >
              {labels.nextArticle}
              <Icon
                name="ChevronDown"
                className="h-3.5 w-3.5 -rotate-90"
                inlineSpacing={false}
                decorative
              />
            </span>
            <span className="font-medium text-slate-900 group-hover:text-sky-700 dark:text-white/90 dark:group-hover:text-sky-300">
              {nextPost.title}
            </span>
            <time
              dateTime={nextPost.date}
              suppressHydrationWarning
              className={`text-sm ${mutedText}`}
            >
              {formatDate(nextPost.date, dateLocale)}
            </time>
          </Link>
        </motion.div>
      ) : (
        <div className="hidden sm:block" />
      )}
    </motion.nav>
  )
}
