'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { animataDuration, animataEase } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export default function PostLayoutMotion({
  children,
  className,
  postPath,
}: {
  children: ReactNode
  className?: string
  postPath: string
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      data-post-shell={postPath}
      layout="position"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : animataDuration, ease: animataEase }}
      className={cn('transform-gpu', className)}
    >
      {children}
    </motion.div>
  )
}
