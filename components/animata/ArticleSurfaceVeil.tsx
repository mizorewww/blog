'use client'

import { motion } from 'motion/react'
import {
  ARTICLE_SURFACE_VEIL_DURATION_SECONDS,
  type ArticleSurfaceVeilState,
} from '@/lib/contentTreeTransition'

export default function ArticleSurfaceVeil({
  state,
  onRevealComplete,
}: {
  state: ArticleSurfaceVeilState
  onRevealComplete: () => void
}) {
  if (state.phase === 'idle' || state.reducedMotion) {
    return null
  }

  return (
    <motion.div
      data-article-surface-veil
      data-article-surface-veil-phase={state.phase}
      aria-hidden="true"
      className="dark:bg-surface-page-dark bg-surface-page pointer-events-none fixed z-[35]"
      style={{
        top: state.rect.top,
        left: state.rect.left,
        width: state.rect.width,
        height: state.rect.height,
      }}
      initial={{ opacity: 1 }}
      animate={{ opacity: state.phase === 'revealing' ? 0 : 1 }}
      transition={{ duration: ARTICLE_SURFACE_VEIL_DURATION_SECONDS, ease: 'easeOut' }}
      onAnimationComplete={() => {
        if (state.phase === 'revealing') {
          onRevealComplete()
        }
      }}
    />
  )
}
