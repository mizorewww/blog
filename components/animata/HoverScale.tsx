'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { animataDuration, animataEase } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export default function HoverScale({
  children,
  className,
  scale = 1.02,
}: {
  children: ReactNode
  className?: string
  scale?: number
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      className={cn(className)}
      whileHover={shouldReduceMotion ? undefined : { scale }}
      transition={{ duration: shouldReduceMotion ? 0 : animataDuration, ease: animataEase }}
    >
      {children}
    </motion.div>
  )
}
