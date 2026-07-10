'use client'

import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import { animataDuration, animataEase } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export default function RevealButton({
  className,
  visible,
  y = 8,
  ...props
}: HTMLMotionProps<'button'> & {
  visible: boolean
  y?: number
}) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.button
      animate={{
        opacity: visible ? 1 : 0,
        y: shouldReduceMotion || visible ? 0 : y,
      }}
      transition={{ duration: shouldReduceMotion ? 0 : animataDuration, ease: animataEase }}
      className={cn(className)}
      {...props}
    />
  )
}
