'use client'

import { useEffect, useState } from 'react'
import RevealButton from '@/components/animata/RevealButton'
import Icon from '@/components/Icon'

export default function BackToTop({ label, onClick }: { label: string; onClick: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let frame = 0

    const updateVisibility = () => {
      frame = 0
      setVisible(window.scrollY > 420)
    }

    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateVisibility)
    }

    updateVisibility()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <RevealButton
      type="button"
      aria-label={label}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={onClick}
      visible={visible}
      y={12}
      className={`dark:bg-surface-card-dark/90 fixed right-4 bottom-5 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-[0_10px_30px_rgba(15,23,42,0.16)] backdrop-blur hover:text-sky-700 sm:right-6 lg:right-8 dark:text-white/75 dark:hover:text-sky-300 ${
        visible ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      <Icon name="ArrowUp" className="h-5 w-5" inlineSpacing={false} />
    </RevealButton>
  )
}
