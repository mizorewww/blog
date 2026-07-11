'use client'

/* eslint-disable @next/next/no-img-element -- The inert transition snapshot reuses the already-loaded runtime currentSrc; it is not content or an LCP image. */
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { articleCardPresentationClasses } from '@/components/ArticleCardPresentation'
import Icon from '@/components/Icon'
import { MetaIcon, metaItemClass } from '@/components/PostMeta'
import { skyLink } from '@/components/ui/styles'
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
  const childLayoutTransition = {
    layout: { duration: layoutDuration, ease: ARTICLE_TRANSITION_EASE },
  }
  const readMoreVisible = layoutMode === 'source' || layoutMode === 'return-target'

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
        layout
        layoutDependency={layoutMode}
        className={articleCardPresentationClasses.content}
        transition={childLayoutTransition}
      >
        <motion.h1
          layout
          layoutDependency={layoutMode}
          data-article-transition-overlay-title
          data-article-transition-overlay-item="title"
          className={articleCardPresentationClasses.title}
          transition={childLayoutTransition}
        >
          {state.snapshot.title}
        </motion.h1>

        {(state.snapshot.gitUpdated || state.snapshot.gitSource) && (
          <motion.div
            layout
            layoutDependency={layoutMode}
            data-article-transition-overlay-item="git"
            className={articleCardPresentationClasses.git}
            transition={childLayoutTransition}
          >
            <div className={articleCardPresentationClasses.gitRow}>
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
            className={articleCardPresentationClasses.summary}
            transition={childLayoutTransition}
          >
            {state.snapshot.summary}
          </motion.p>
        )}

        <motion.div
          layout
          layoutDependency={layoutMode}
          className={articleCardPresentationClasses.footer}
          transition={childLayoutTransition}
        >
          <div className={articleCardPresentationClasses.footerMeta}>
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
            className={articleCardPresentationClasses.readMoreSlot}
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
            <span className={articleCardPresentationClasses.readMore}>
              <span>{state.snapshot.readMore}</span>
              <Icon name="ArrowRight" className="h-4 w-4" inlineSpacing={false} decorative />
            </span>
          </motion.div>
        </motion.div>
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
