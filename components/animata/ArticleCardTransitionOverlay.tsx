'use client'

/* eslint-disable @next/next/no-img-element -- The inert transition snapshot reuses the already-loaded runtime currentSrc; it is not content or an LCP image. */
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { getArticleCardPresentationClasses } from '@/components/ArticleCardPresentation'
import Icon from '@/components/Icon'
import { MetaIcon, metaItemClass } from '@/components/PostMeta'
import { imageOutlineClass, skyLink } from '@/components/ui/styles'
import {
  ARTICLE_TRANSITION_BACKGROUND_DURATION_SECONDS,
  ARTICLE_TRANSITION_EASE,
  ARTICLE_TRANSITION_EXIT_DURATION_SECONDS,
  ARTICLE_TRANSITION_OPEN_DURATION_SECONDS,
  ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS,
  ARTICLE_TRANSITION_RETURN_DURATION_SECONDS,
  type ArticleTransitionGeometry,
  type ArticleTransitionSequence,
  type ArticleTransitionState,
} from '@/lib/articleTransition'

type VisibleTransitionState = Extract<
  ArticleTransitionState,
  { phase: 'opening' | 'return-waiting' | 'returning' }
>

type LayoutMode = 'source' | 'destination' | 'return-target'

function destinationCoverHeight(destination: ArticleTransitionGeometry) {
  return destination.width >= 640 ? destination.width / 2.8 : destination.width / 2
}

function visibleState(state: ArticleTransitionState): VisibleTransitionState | null {
  return ['opening', 'return-waiting', 'returning'].includes(state.phase)
    ? (state as VisibleTransitionState)
    : null
}

function TransitionSurface({
  sequence,
  state,
  onOpenMotionComplete,
  onReturnMorphComplete,
  onReturnMotionComplete,
}: {
  sequence: ArticleTransitionSequence
  state: VisibleTransitionState
  onOpenMotionComplete: () => void
  onReturnMorphComplete: () => void
  onReturnMotionComplete: () => void
}) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    state.phase === 'opening' && !state.reducedMotion ? 'source' : 'destination'
  )

  useEffect(() => {
    if (state.reducedMotion) {
      return
    }

    if (state.phase === 'opening' && sequence === 'morph' && layoutMode === 'source') {
      const frame = window.requestAnimationFrame(() => setLayoutMode('destination'))

      return () => window.cancelAnimationFrame(frame)
    }

    if (state.phase === 'returning' && sequence === 'morph' && layoutMode !== 'return-target') {
      const frame = window.requestAnimationFrame(() => setLayoutMode('return-target'))

      return () => window.cancelAnimationFrame(frame)
    }

    if (state.phase === 'return-waiting' && layoutMode === 'return-target') {
      setLayoutMode('destination')
    }
  }, [layoutMode, sequence, state.phase, state.reducedMotion])

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
  const childLayoutTransition = {
    layout: { duration: layoutDuration, ease: ARTICLE_TRANSITION_EASE },
  }
  const readMoreVisible = layoutMode === 'source' || layoutMode === 'return-target'
  const presentationClasses = getArticleCardPresentationClasses(
    readMoreVisible ? 'card' : 'article'
  )

  return (
    <motion.div
      layout
      layoutDependency={layoutMode}
      data-article-transition-overlay-surface
      className="article-reading-surface dark:bg-surface-card-dark absolute z-10 overflow-hidden bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/5 dark:shadow-black/30 dark:ring-white/10"
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
          onReturnMorphComplete()
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
          className={`${imageOutlineClass} h-full w-full object-cover`}
        />
      </motion.div>

      <motion.div
        layout
        layoutDependency={layoutMode}
        className={presentationClasses.content}
        transition={childLayoutTransition}
      >
        <motion.h1
          layout
          layoutDependency={layoutMode}
          data-article-transition-overlay-title
          data-article-transition-overlay-item="title"
          className={presentationClasses.title}
          transition={childLayoutTransition}
        >
          {state.snapshot.title}
        </motion.h1>

        {(state.snapshot.gitUpdated || state.snapshot.gitSource) && (
          <motion.div
            layout
            layoutDependency={layoutMode}
            data-article-transition-overlay-item="git"
            className={presentationClasses.git}
            transition={childLayoutTransition}
          >
            <div className={presentationClasses.gitRow}>
              {state.snapshot.gitUpdated && (
                <motion.span
                  layout
                  layoutDependency={layoutMode}
                  data-article-transition-overlay-item="git-updated"
                  className={metaItemClass}
                  transition={childLayoutTransition}
                >
                  <MetaIcon name="clock" />
                  <span className="min-w-0">{state.snapshot.gitUpdated}</span>
                </motion.span>
              )}
              {state.snapshot.gitSource && (
                <motion.span
                  layout
                  layoutDependency={layoutMode}
                  data-article-transition-overlay-item="git-source"
                  className={`inline-flex items-center gap-1.5 ${skyLink}`}
                  transition={childLayoutTransition}
                >
                  <MetaIcon name="code" />
                  <span>{state.snapshot.gitSource}</span>
                </motion.span>
              )}
            </div>
          </motion.div>
        )}

        {state.snapshot.summary && (
          <motion.p
            layout
            layoutDependency={layoutMode}
            data-article-transition-overlay-item="summary"
            className={presentationClasses.summary}
            transition={childLayoutTransition}
          >
            {state.snapshot.summary}
          </motion.p>
        )}

        <motion.div
          layout
          layoutDependency={layoutMode}
          className={presentationClasses.footer}
          transition={childLayoutTransition}
        >
          <div className={presentationClasses.footerMeta}>
            <motion.span
              layout
              layoutDependency={layoutMode}
              data-article-transition-overlay-item="date"
              className={metaItemClass}
              transition={childLayoutTransition}
            >
              <MetaIcon name="calendar" />
              <span className="min-w-0">{state.snapshot.publishedDate}</span>
            </motion.span>
            {state.snapshot.primaryTag && (
              <motion.span
                layout
                layoutDependency={layoutMode}
                data-article-transition-overlay-item="primary-tag"
                className={metaItemClass}
                transition={childLayoutTransition}
              >
                <MetaIcon name="tag" />
                <span className="min-w-0">{state.snapshot.primaryTag}</span>
              </motion.span>
            )}
          </div>

          <motion.div
            layout
            layoutDependency={layoutMode}
            data-article-transition-overlay-item="read-more"
            className={presentationClasses.readMoreSlot}
            initial={false}
            animate={{ opacity: readMoreVisible ? 1 : 0 }}
            transition={{
              ...childLayoutTransition,
              opacity: {
                duration: state.reducedMotion ? 0 : layoutDuration * 0.72,
                ease: ARTICLE_TRANSITION_EASE,
              },
            }}
          >
            <span className={presentationClasses.readMore}>
              <span>{state.snapshot.readMore}</span>
              <Icon name="ArrowRight" className="h-4 w-4" inlineSpacing={false} decorative />
            </span>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

function OverlayRoot({
  state,
  onOpenMotionComplete,
  onReturnMotionComplete,
  onSequenceChange,
  onUnderlayReady,
}: {
  state: VisibleTransitionState
  onOpenMotionComplete: () => void
  onReturnMotionComplete: () => void
  onSequenceChange?: (sequence: ArticleTransitionSequence | null) => void
  onUnderlayReady?: () => void
}) {
  const [sequence, setSequence] = useState<ArticleTransitionSequence>('background')
  const [backgroundReady, setBackgroundReady] = useState(state.reducedMotion)

  useEffect(() => {
    onSequenceChange?.(state.reducedMotion ? null : sequence)
  }, [onSequenceChange, sequence, state.reducedMotion])

  useEffect(() => {
    return () => onSequenceChange?.(null)
  }, [onSequenceChange])

  useEffect(() => {
    if (state.reducedMotion) {
      return
    }

    if (state.phase === 'return-waiting') {
      setSequence('background')
    }
  }, [state.phase, state.reducedMotion])

  useEffect(() => {
    if (state.reducedMotion || !backgroundReady || sequence !== 'background') {
      return
    }

    if (state.phase === 'opening' || state.phase === 'returning') {
      setSequence('morph')
    }
  }, [backgroundReady, sequence, state.phase, state.reducedMotion])

  const handleUnderlayAnimationComplete = () => {
    if (state.reducedMotion) {
      return
    }

    if (sequence === 'settle' && state.phase === 'returning') {
      onReturnMotionComplete()
      return
    }

    if (sequence === 'background') {
      setBackgroundReady(true)
      onUnderlayReady?.()
    }
  }

  const handleReturnMorphComplete = () => {
    setSequence('settle')
  }

  return (
    <motion.div
      layoutRoot
      data-article-transition-overlay
      data-article-transition-phase={state.phase}
      data-article-transition-reduced={state.reducedMotion ? 'true' : 'false'}
      data-article-transition-sequence={state.reducedMotion ? undefined : sequence}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40"
      initial={false}
      exit={{ opacity: 0 }}
      transition={{
        duration: state.reducedMotion
          ? ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS
          : ARTICLE_TRANSITION_EXIT_DURATION_SECONDS,
      }}
    >
      {!state.reducedMotion && (
        <motion.div
          data-article-transition-underlay
          data-article-transition-underlay-fade
          className="dark:bg-surface-page-dark bg-surface-page absolute inset-0 z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: sequence === 'settle' ? 0 : 1 }}
          transition={{
            duration: ARTICLE_TRANSITION_BACKGROUND_DURATION_SECONDS,
            ease: 'easeOut',
          }}
          onAnimationComplete={handleUnderlayAnimationComplete}
        />
      )}
      <TransitionSurface
        key={state.snapshot.key}
        sequence={sequence}
        state={state}
        onOpenMotionComplete={onOpenMotionComplete}
        onReturnMorphComplete={handleReturnMorphComplete}
        onReturnMotionComplete={onReturnMotionComplete}
      />
    </motion.div>
  )
}

export default function ArticleCardTransitionOverlay({
  state,
  onOpenMotionComplete,
  onReturnMotionComplete,
  onSequenceChange,
  onUnderlayReady,
}: {
  state: ArticleTransitionState
  onOpenMotionComplete: () => void
  onReturnMotionComplete: () => void
  onSequenceChange?: (sequence: ArticleTransitionSequence | null) => void
  onUnderlayReady?: () => void
}) {
  const visible = visibleState(state)

  return (
    <AnimatePresence>
      {visible && (
        <OverlayRoot
          key="article-card-transition"
          state={visible}
          onOpenMotionComplete={onOpenMotionComplete}
          onReturnMotionComplete={onReturnMotionComplete}
          onSequenceChange={onSequenceChange}
          onUnderlayReady={onUnderlayReady}
        />
      )}
    </AnimatePresence>
  )
}
