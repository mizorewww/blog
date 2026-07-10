'use client'

/* eslint-disable @next/next/no-img-element -- The inert transition snapshot reuses the already-loaded runtime currentSrc; it is not content or an LCP image. */
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import {
  ARTICLE_TRANSITION_EASE,
  ARTICLE_TRANSITION_EXIT_DURATION_SECONDS,
  ARTICLE_TRANSITION_OPEN_DURATION_SECONDS,
  ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS,
  ARTICLE_TRANSITION_RETURN_DURATION_SECONDS,
  type ArticleTransitionGeometry,
  type ArticleTransitionState,
} from '@/lib/articleTransition'

type VisibleTransitionState = Extract<
  ArticleTransitionState,
  { phase: 'opening' | 'return-waiting' | 'returning' }
>

type LayoutMode = 'source' | 'destination' | 'return-target'

function destinationCoverHeight(destination: ArticleTransitionGeometry) {
  return (destination.width * 9) / 16
}

function visibleState(state: ArticleTransitionState): VisibleTransitionState | null {
  return ['opening', 'return-waiting', 'returning'].includes(state.phase)
    ? (state as VisibleTransitionState)
    : null
}

function TransitionSurface({
  state,
  onOpenMotionComplete,
  onReturnMotionComplete,
}: {
  state: VisibleTransitionState
  onOpenMotionComplete: () => void
  onReturnMotionComplete: () => void
}) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    state.phase === 'opening' && !state.reducedMotion ? 'source' : 'destination'
  )

  useEffect(() => {
    if (state.phase === 'opening' && !state.reducedMotion && layoutMode === 'source') {
      const frame = window.requestAnimationFrame(() => setLayoutMode('destination'))

      return () => window.cancelAnimationFrame(frame)
    }

    if (state.phase === 'returning' && !state.reducedMotion) {
      setLayoutMode('return-target')
    }
  }, [layoutMode, state.phase, state.reducedMotion])

  const geometry =
    layoutMode === 'source'
      ? { ...state.snapshot.cardRect, radius: state.snapshot.radius }
      : layoutMode === 'return-target' && state.phase === 'returning'
        ? { ...state.target.cardRect, radius: state.target.radius }
        : state.destination
  const coverHeight =
    layoutMode === 'source'
      ? state.snapshot.coverRect.height
      : layoutMode === 'return-target' && state.phase === 'returning'
        ? state.target.coverRect.height
        : destinationCoverHeight(state.destination)
  const layoutDuration =
    state.phase === 'returning'
      ? ARTICLE_TRANSITION_RETURN_DURATION_SECONDS
      : ARTICLE_TRANSITION_OPEN_DURATION_SECONDS
  const reducedOpacity =
    state.reducedMotion && state.phase === 'returning'
      ? 0
      : state.reducedMotion && state.phase === 'opening'
        ? 1
        : undefined
  const containStyle: CSSProperties = {
    contain: 'layout paint style',
    top: geometry.top,
    left: geometry.left,
    width: geometry.width,
    height: geometry.height,
    borderRadius: geometry.radius,
  }

  return (
    <motion.div
      layout
      layoutDependency={layoutMode}
      data-article-transition-overlay-surface
      className="dark:bg-surface-card-dark absolute overflow-hidden bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/5 dark:shadow-black/30 dark:ring-white/10"
      style={containStyle}
      initial={state.reducedMotion && state.phase === 'opening' ? { opacity: 0.72 } : false}
      animate={reducedOpacity === undefined ? { opacity: 1 } : { opacity: reducedOpacity }}
      transition={{
        layout: { duration: layoutDuration, ease: ARTICLE_TRANSITION_EASE },
        opacity: {
          duration: state.reducedMotion ? ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS : 0,
        },
      }}
      onLayoutAnimationComplete={() => {
        if (!state.reducedMotion && state.phase === 'opening' && layoutMode === 'destination') {
          onOpenMotionComplete()
        } else if (
          !state.reducedMotion &&
          state.phase === 'returning' &&
          layoutMode === 'return-target'
        ) {
          onReturnMotionComplete()
        }
      }}
      onAnimationComplete={() => {
        if (!state.reducedMotion) {
          return
        }

        if (state.phase === 'opening') {
          onOpenMotionComplete()
        } else if (state.phase === 'returning') {
          onReturnMotionComplete()
        }
      }}
    >
      <motion.div
        layout
        layoutDependency={layoutMode}
        data-article-transition-overlay-cover
        className="dark:bg-surface-cover-dark relative w-full overflow-hidden bg-slate-100"
        style={{ height: coverHeight }}
        transition={{ layout: { duration: layoutDuration, ease: ARTICLE_TRANSITION_EASE } }}
      >
        <img
          src={state.snapshot.imageSrc}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      </motion.div>

      <motion.div
        layout="position"
        layoutDependency={layoutMode}
        className="overflow-hidden px-5 py-5 sm:px-6 sm:py-6"
        initial={state.phase === 'opening' && !state.reducedMotion ? { opacity: 1 } : false}
        animate={{
          opacity:
            state.reducedMotion || state.phase === 'return-waiting'
              ? 0
              : state.phase === 'returning'
                ? 1
                : 0,
        }}
        transition={{
          layout: { duration: layoutDuration, ease: ARTICLE_TRANSITION_EASE },
          opacity:
            state.phase === 'opening'
              ? { duration: 0.1, delay: state.reducedMotion ? 0 : 0.26 }
              : { duration: state.phase === 'returning' ? 0.12 : 0 },
        }}
      >
        <div
          data-article-transition-overlay-title
          className="text-[1.55rem] leading-tight font-medium text-slate-900 sm:text-[1.75rem] dark:text-white/90"
        >
          {state.snapshot.title}
        </div>
        {state.snapshot.summary && (
          <p className="mt-3 max-h-24 overflow-hidden text-base leading-8 text-slate-600 dark:text-white/75">
            {state.snapshot.summary}
          </p>
        )}
        {state.snapshot.meta && (
          <p className="mt-4 max-h-12 overflow-hidden text-sm text-slate-500 dark:text-white/60">
            {state.snapshot.meta}
          </p>
        )}
      </motion.div>
    </motion.div>
  )
}

export default function ArticleCardTransitionOverlay({
  state,
  onOpenMotionComplete,
  onReturnMotionComplete,
}: {
  state: ArticleTransitionState
  onOpenMotionComplete: () => void
  onReturnMotionComplete: () => void
}) {
  const visible = visibleState(state)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          layoutRoot
          key="article-card-transition"
          data-article-transition-overlay
          data-article-transition-phase={visible.phase}
          data-article-transition-reduced={visible.reducedMotion ? 'true' : 'false'}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40"
          initial={false}
          exit={{ opacity: 0 }}
          transition={{ duration: ARTICLE_TRANSITION_EXIT_DURATION_SECONDS }}
        >
          <TransitionSurface
            key={visible.snapshot.key}
            state={visible}
            onOpenMotionComplete={onOpenMotionComplete}
            onReturnMotionComplete={onReturnMotionComplete}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
