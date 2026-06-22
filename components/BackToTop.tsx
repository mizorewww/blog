'use client'

import { useEffect, useState } from 'react'
import Icon from '@/components/Icon'

export default function BackToTop({ label, onClick }: { label: string; onClick: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 420)

    updateVisibility()
    window.addEventListener('scroll', updateVisibility, { passive: true })

    return () => window.removeEventListener('scroll', updateVisibility)
  }, [])

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`dark:bg-surface-card-dark/90 fixed right-4 bottom-5 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-[0_10px_30px_rgba(15,23,42,0.16)] backdrop-blur transition duration-300 hover:text-sky-500 sm:right-6 lg:right-8 dark:text-white/75 dark:hover:text-sky-400 ${
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <Icon name="ArrowUp" className="h-5 w-5" inlineSpacing={false} />
    </button>
  )
}
