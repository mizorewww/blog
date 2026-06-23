import { animate, type AnimationPlaybackControls } from 'motion'
import type { MutableRefObject } from 'react'
import { animataEase, animataPostDuration } from '@/components/animata/motion'

export const DESKTOP_EXPANDED_TARGET_OFFSET = 96
export const MOBILE_EXPANDED_TARGET_OFFSET = 88

type MotionControlRef = MutableRefObject<AnimationPlaybackControls | null>

export function getExpandedTargetOffset() {
  return window.matchMedia('(max-width: 639px)').matches
    ? MOBILE_EXPANDED_TARGET_OFFSET
    : DESKTOP_EXPANDED_TARGET_OFFSET
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function setScrollY(top: number) {
  const root = document.documentElement
  const previousScrollBehavior = root.style.scrollBehavior

  root.style.scrollBehavior = 'auto'
  window.scrollTo(0, top)
  root.style.scrollBehavior = previousScrollBehavior
}

export function getPostShell(postPath: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-post-shell]')).find(
    (shell) => shell.dataset.postShell === postPath
  )
}

export function getMainColumnHeight() {
  const mainColumn = document.querySelector<HTMLElement>('.blog-main-column')

  return mainColumn ? Math.ceil(mainColumn.getBoundingClientRect().height) : null
}

export function setPostTop(postPath: string, targetTop: number) {
  const shell = getPostShell(postPath)
  if (!shell) return

  const currentTop = shell.getBoundingClientRect().top
  setScrollY(window.scrollY + currentTop - targetTop)
}

export function getMaxScrollY() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

export function getMissingScrollRunway(postPath: string, targetTop: number) {
  const shell = getPostShell(postPath)

  if (!shell) {
    return 0
  }

  const requiredScrollY = window.scrollY + shell.getBoundingClientRect().top - targetTop

  return Math.max(0, requiredScrollY - getMaxScrollY())
}

function stopMotion(controlRef: MotionControlRef) {
  if (controlRef.current) {
    controlRef.current.stop()
    controlRef.current = null
  }
}

export function animateScrollTo(
  targetY: number,
  controlRef: MotionControlRef,
  onComplete?: () => void
) {
  stopMotion(controlRef)

  const startY = window.scrollY

  if (prefersReducedMotion() || Math.abs(targetY - startY) < 1) {
    setScrollY(targetY)
    onComplete?.()
    return
  }

  const controls = animate(startY, targetY, {
    duration: animataPostDuration,
    ease: animataEase,
    onUpdate: setScrollY,
    onComplete: () => {
      if (controlRef.current === controls) {
        controlRef.current = null
      }
      setScrollY(targetY)
      onComplete?.()
    },
  })

  controlRef.current = controls
}

export function animatePostTopTo(
  postPath: string,
  startTop: number,
  targetTop: number,
  controlRef: MotionControlRef,
  onComplete?: () => void
) {
  stopMotion(controlRef)

  if (prefersReducedMotion() || Math.abs(targetTop - startTop) < 1) {
    setPostTop(postPath, targetTop)
    onComplete?.()
    return
  }

  const controls = animate(startTop, targetTop, {
    duration: animataPostDuration,
    ease: animataEase,
    onUpdate: (top) => setPostTop(postPath, top),
    onComplete: () => {
      if (controlRef.current === controls) {
        controlRef.current = null
      }
      setPostTop(postPath, targetTop)
      onComplete?.()
    },
  })

  controlRef.current = controls
}

export function holdPostTop(
  postPath: string,
  targetTop: number,
  controlRef: MotionControlRef,
  onComplete?: () => void
) {
  stopMotion(controlRef)

  setPostTop(postPath, targetTop)

  if (prefersReducedMotion()) {
    onComplete?.()
    return
  }

  const controls = animate(0, 1, {
    duration: animataPostDuration,
    ease: animataEase,
    onUpdate: () => setPostTop(postPath, targetTop),
    onComplete: () => {
      if (controlRef.current === controls) {
        controlRef.current = null
      }
      setPostTop(postPath, targetTop)
      onComplete?.()
    },
  })

  controlRef.current = controls
}
