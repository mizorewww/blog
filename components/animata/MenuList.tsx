'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { animataEase, animataQuickDuration } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export function MenuList({ children, className }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      initial={shouldReduceMotion ? false : 'hidden'}
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: shouldReduceMotion ? 0 : 0.045,
          },
        },
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  )
}

export function MenuListItem({ children, className }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      variants={{
        hidden: shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0 },
      }}
      transition={{ duration: shouldReduceMotion ? 0 : animataQuickDuration, ease: animataEase }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  )
}
