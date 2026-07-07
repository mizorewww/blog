'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { animataEase, animataPostDuration } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

/**
 * Wraps each post card. Uses Motion layout="position" to animate the
 * card's position when the layout changes (e.g. another card's body
 * expands/collapses, pushing this card down/up).
 *
 * No collapsed/hidden state — cards are always visible. The reflow
 * animation is handled entirely by Motion's layout engine.
 */
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
      initial={false}
      transition={
        shouldReduceMotion ? { duration: 0 } : { duration: animataPostDuration, ease: animataEase }
      }
      className={cn('transform-gpu', className)}
    >
      {children}
    </motion.div>
  )
}
