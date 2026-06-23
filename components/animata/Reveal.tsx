'use client'

import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import type { ReactNode } from 'react'
import { animataDuration, animataEase } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export function Reveal({
  children,
  className,
  visible = true,
  y = 12,
  ...props
}: HTMLMotionProps<'div'> & {
  children: ReactNode
  visible?: boolean
  y?: number
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: visible ? 1 : 0,
        y: shouldReduceMotion || visible ? 0 : y,
      }}
      transition={{ duration: shouldReduceMotion ? 0 : animataDuration, ease: animataEase }}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.div>
  )
}
