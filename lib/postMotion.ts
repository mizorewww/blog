import type { MutableRefObject } from 'react'

export const MOTION_DURATION = 560
export const DESKTOP_EXPANDED_TARGET_OFFSET = 96
export const MOBILE_EXPANDED_TARGET_OFFSET = 88

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function getExpandedTargetOffset() {
  return window.matchMedia('(max-width: 639px)').matches
    ? MOBILE_EXPANDED_TARGET_OFFSET
    : DESKTOP_EXPANDED_TARGET_OFFSET
}

function cubicBezierCoordinate(t: number, point1: number, point2: number) {
  const inverse = 1 - t

  return 3 * inverse * inverse * t * point1 + 3 * inverse * t * t * point2 + t * t * t
}

function cubicBezierDerivative(t: number, point1: number, point2: number) {
  const inverse = 1 - t

  return (
    3 * inverse * inverse * point1 + 6 * inverse * t * (point2 - point1) + 3 * t * t * (1 - point2)
  )
}

export function easeMotion(progress: number) {
  let t = progress

  for (let index = 0; index < 5; index += 1) {
    const x = cubicBezierCoordinate(t, 0.22, 0.36) - progress
    const derivative = cubicBezierDerivative(t, 0.22, 0.36)

    if (Math.abs(x) < 0.0001 || derivative === 0) break
    t = Math.min(1, Math.max(0, t - x / derivative))
  }

  return cubicBezierCoordinate(t, 1, 1)
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

export function animateScrollTo(
  targetY: number,
  duration: number,
  frameRef: MutableRefObject<number | null>,
  onComplete?: () => void
) {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  const startY = window.scrollY
  const distance = targetY - startY

  if (prefersReducedMotion() || Math.abs(distance) < 1) {
    setScrollY(targetY)
    onComplete?.()
    return
  }

  const startedAt = performance.now()

  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    setScrollY(startY + distance * easeMotion(progress))

    if (progress < 1) {
      frameRef.current = window.requestAnimationFrame(tick)
      return
    }

    frameRef.current = null
    setScrollY(targetY)
    onComplete?.()
  }

  frameRef.current = window.requestAnimationFrame(tick)
}

export function animatePostTopTo(
  postPath: string,
  startTop: number,
  targetTop: number,
  duration: number,
  frameRef: MutableRefObject<number | null>,
  onComplete?: () => void
) {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }

  if (prefersReducedMotion()) {
    setPostTop(postPath, targetTop)
    onComplete?.()
    return
  }

  const startedAt = performance.now()

  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const desiredTop = startTop + (targetTop - startTop) * easeMotion(progress)

    setPostTop(postPath, desiredTop)

    if (progress < 1) {
      frameRef.current = window.requestAnimationFrame(tick)
      return
    }

    frameRef.current = null
    setPostTop(postPath, targetTop)
    onComplete?.()
  }

  frameRef.current = window.requestAnimationFrame(tick)
}
