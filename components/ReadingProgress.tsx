'use client'

import { motion, useScroll, useSpring, useTransform, useReducedMotion } from 'motion/react'

export default function ReadingProgress({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLElement | null>
}) {
  const shouldReduceMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ['start 96px', 'end end'],
  })
  const rawWidth = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])
  const width = useSpring(rawWidth, {
    stiffness: 400,
    damping: 40,
    restSpeed: 0.1,
  })
  const opacity = useTransform(scrollYProgress, [0, 0.02], [0, 1])

  if (shouldReduceMotion) {
    return (
      <motion.div
        style={{ width: rawWidth, opacity }}
        className="fixed top-0 left-0 z-[55] h-1 origin-left bg-sky-500 dark:bg-sky-400"
        aria-hidden="true"
      />
    )
  }

  return (
    <motion.div
      style={{ width, opacity }}
      className="fixed top-0 left-0 z-[55] h-1 origin-left bg-sky-500 dark:bg-sky-400"
      aria-hidden="true"
    />
  )
}
