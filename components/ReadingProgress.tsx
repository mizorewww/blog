'use client'

import { useEffect, useState } from 'react'

export default function ReadingProgress({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLElement | null>
}) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    let frame = 0

    const update = () => {
      frame = 0
      const rect = target.getBoundingClientRect()
      const articleTop = rect.top + window.scrollY
      const articleBottom = rect.bottom + window.scrollY
      const scrollY = window.scrollY
      const viewport = window.innerHeight
      const headerOffset = 96

      const start = articleTop - headerOffset
      const end = articleBottom - viewport
      const total = end - start

      if (total <= 0) {
        setProgress(0)
        return
      }

      const pct = Math.max(0, Math.min(100, ((scrollY - start) / total) * 100))
      setProgress(pct)
    }

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [targetRef])

  if (progress <= 0.5) return null

  return (
    <div
      className="fixed top-0 left-0 z-[55] h-1 bg-sky-500 transition-[width] duration-75 ease-out dark:bg-sky-400"
      style={{ width: `${progress}%` }}
      aria-hidden="true"
    />
  )
}
