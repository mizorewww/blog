'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { animataDuration, animataEase } from '@/components/animata/motion'

export default function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const shouldReduceMotion = useReducedMotion()

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
        transition={{ duration: shouldReduceMotion ? 0 : animataDuration, ease: animataEase }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
