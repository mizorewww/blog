'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { animataDuration, animataEase } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export default function SlideHeader({
  children,
  className,
  hidden,
}: {
  children: ReactNode
  className?: string
  hidden: boolean
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.header
      animate={{
        opacity: hidden ? 0 : 1,
        y: shouldReduceMotion || !hidden ? 0 : '-100%',
      }}
      transition={{ duration: shouldReduceMotion ? 0 : animataDuration, ease: animataEase }}
      className={cn(className)}
    >
      {children}
    </motion.header>
  )
}
