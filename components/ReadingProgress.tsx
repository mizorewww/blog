'use client'

import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react'
import type { RefObject } from 'react'

export default function ReadingProgress({
  targetRef,
}: {
  targetRef: RefObject<HTMLElement | null>
}) {
  const shouldReduceMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ['start 96px', 'end end'],
  })
  const width = useSpring(scrollYProgress, {
    stiffness: 400,
    damping: 40,
    restSpeed: 0.1,
  })

  return (
    <motion.div
      data-reading-progress
      style={{ scaleX: shouldReduceMotion ? scrollYProgress : width }}
      className="fixed top-0 left-0 z-[55] h-1 w-full origin-left bg-sky-500 dark:bg-sky-400"
      aria-hidden="true"
    />
  )
}
