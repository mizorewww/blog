'use client'

import { animate, type AnimationPlaybackControls } from 'motion'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animataDuration, animataEase } from '@/components/animata/motion'
import { isPendingBlogRouteMotion, normalizePathname } from '@/lib/blogRouteState'

type PageTransitionState = 'idle' | 'active' | 'suppressed' | 'reduced'

export default function PageTransition({
  children,
  pathname,
}: {
  children: ReactNode
  pathname: string
}) {
  const shouldReduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)
  const normalizedPathname = normalizePathname(pathname)
  const [settledPathname, setSettledPathname] = useState(normalizedPathname)
  const [transitionState, setTransitionState] = useState<PageTransitionState>('idle')
  const routeIsPending = settledPathname !== normalizedPathname
  const articleMotionOwnsRoute =
    routeIsPending && isPendingBlogRouteMotion(settledPathname, normalizedPathname)

  useLayoutEffect(() => {
    if (!routeIsPending) {
      setTransitionState('idle')
      return
    }

    const container = containerRef.current

    animationRef.current?.stop()
    animationRef.current = null

    if (articleMotionOwnsRoute || shouldReduceMotion || !container) {
      setTransitionState(articleMotionOwnsRoute ? 'suppressed' : 'reduced')
      if (container) {
        container.style.opacity = ''
        container.style.transform = ''
      }
      setSettledPathname(normalizedPathname)
      return
    }

    setTransitionState('active')
    container.style.opacity = '0.94'
    container.style.transform = 'translateY(12px)'

    const controls = animate(
      container,
      { opacity: 1, transform: 'translateY(0px)' },
      {
        duration: animataDuration,
        ease: animataEase,
        onComplete: () => {
          if (animationRef.current === controls) {
            animationRef.current = null
          }
          container.style.opacity = ''
          container.style.transform = ''
          setSettledPathname(normalizedPathname)
          setTransitionState('idle')
        },
      }
    )

    animationRef.current = controls

    return () => {
      if (animationRef.current === controls) {
        controls.stop()
        animationRef.current = null
      }
    }
  }, [
    articleMotionOwnsRoute,
    normalizedPathname,
    routeIsPending,
    settledPathname,
    shouldReduceMotion,
  ])

  return (
    <AnimatePresence initial={false}>
      <motion.div
        ref={containerRef}
        data-animata-page-transition={transitionState}
        data-animata-page-transition-route={normalizedPathname}
        className="min-w-0"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
