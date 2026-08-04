'use client'

import { useState } from 'react'
import { useScroll, useMotionValueEvent } from 'motion/react'
import RevealButton from '@/components/animata/RevealButton'
import Icon from '@/components/Icon'

export default function BackToTop({ label, onClick }: { label: string; onClick: () => void }) {
  const [visible, setVisible] = useState(false)
  const { scrollY } = useScroll()

  useMotionValueEvent(scrollY, 'change', (y) => setVisible(y > 420))

  return (
    <RevealButton
      type="button"
      aria-label={label}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={onClick}
      visible={visible}
      y={12}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className={`dark:bg-surface-card-dark/90 fixed right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-white/90 text-slate-600 shadow-[0_10px_30px_rgba(15,23,42,0.16)] backdrop-blur hover:text-sky-700 sm:right-[calc(1.5rem+env(safe-area-inset-right))] lg:right-[calc(2rem+env(safe-area-inset-right))] dark:text-white/75 dark:hover:text-sky-300 ${
        visible ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      <Icon name="ArrowUp" className="h-5 w-5" inlineSpacing={false} />
    </RevealButton>
  )
}
