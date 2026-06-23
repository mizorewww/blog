'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { animataEase, animataPostDuration } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export default function PostLayoutMotion({
  children,
  className,
  collapsed,
  direction = 'down',
  isTransitionTarget,
  postPath,
}: {
  children: ReactNode
  className?: string
  collapsed?: boolean
  direction?: 'up' | 'down'
  isTransitionTarget?: boolean
  postPath: string
}) {
  const shouldReduceMotion = useReducedMotion()
  const offset = direction === 'up' ? -32 : 32

  return (
    <motion.div
      data-post-shell={postPath}
      layout="position"
      initial={false}
      animate={{
        opacity: collapsed ? 0 : 1,
        y: collapsed ? offset : 0,
        gridTemplateRows: collapsed ? '0fr' : '1fr',
      }}
      transition={{
        duration: shouldReduceMotion ? 0 : animataPostDuration,
        ease: animataEase,
      }}
      aria-hidden={collapsed || undefined}
      className={cn(
        'grid transform-gpu overflow-hidden',
        isTransitionTarget ? 'mt-0' : className,
        shouldReduceMotion && 'motion-reduce:transition-none'
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </motion.div>
  )
}
