'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { animataDuration, animataEase } from '@/components/animata/motion'
import { cn } from '@/lib/utils'

export default function CollapsiblePanel({
  children,
  className,
  contentClassName,
  id,
  open,
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
  id?: string
  open: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  // Skip the enter animation when the panel is already open on first render so
  // surrounding layout (and any transition overlay measuring it) stays stable.
  const isInitialMount = useRef(true)
  useEffect(() => {
    isInitialMount.current = false
  }, [])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="content"
          id={id}
          data-animata-collapsible={id}
          initial={shouldReduceMotion || isInitialMount.current ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={shouldReduceMotion ? { height: 0, opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : animataDuration, ease: animataEase }}
          className={cn('overflow-hidden', className)}
        >
          <div className={contentClassName}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
