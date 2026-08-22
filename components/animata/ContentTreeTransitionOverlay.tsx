'use client'

import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, useState } from 'react'
import ContentTree from '@/components/ContentTree'
import { widgetCardClass } from '@/components/ui/styles'
import {
  CONTENT_TREE_TRANSITION_EASE,
  getContentTreeSlideDuration,
  type ContentTreeTransitionState,
} from '@/lib/contentTreeTransition'

type ContentTreeCompletePolicy = 'self' | 'card-sequence'
import { getLocaleFromPathname } from '@/lib/i18n'

type VisibleTreeState = Extract<
  ContentTreeTransitionState,
  { phase: 'opening' | 'return-waiting' | 'returning' }
>

function visibleState(state: ContentTreeTransitionState): VisibleTreeState | null {
  return ['opening', 'return-waiting', 'returning'].includes(state.phase)
    ? (state as VisibleTreeState)
    : null
}

function boxStyle(
  rect: { top: number; left: number; width: number; height: number },
  opacity: number
) {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    opacity,
  }
}

function TreeSurface({
  concealDestination,
  completePolicy,
  holdMotion,
  slideDuration,
  state,
  onOpenMotionComplete,
  onReturnMotionComplete,
}: {
  concealDestination: boolean
  completePolicy: ContentTreeCompletePolicy
  holdMotion: boolean
  slideDuration: number
  state: VisibleTreeState
  onOpenMotionComplete: () => void
  onReturnMotionComplete: () => void
}) {
  const source = state.snapshot.sourceRect
  const destination = state.destination
  const target = state.phase === 'returning' ? state.target : destination
  const opening = state.phase === 'opening'
  const returning = state.phase === 'returning'
  const reducedOpacity = state.reducedMotion && returning ? 0 : 1
  const holdRect = opening ? source : destination
  // Held phase. The card-companion path is held by the card-driven holdMotion.
  // The solo path (tree-link navigation, completePolicy 'self') has no card, so
  // the overlay holds itself: on open it stays at the source until the fast bg
  // fade completes (event-driven via the bg layer's onAnimationComplete, never a
  // timer), then glides; on return it stays at the rail for 'return-waiting',
  // then glides. While held it mirrors the source chrome/padding so it matches
  // the tree the user was just looking at; once gliding it switches to the
  // destination chrome so it lands pixel-identical to the real tree.
  const [bgFadeComplete, setBgFadeComplete] = useState(false)
  // The solo open holds at the source until BOTH the fast bg fade has completed
  // AND the article route has committed (so the bare tree glides over as the
  // article surface appears, and a slow target keeps the source chrome while it
  // loads instead of reflowing early). The companion path is held by the card.
  const routeCommitted = state.phase === 'opening' ? state.routeCommitted : true
  const soloOpenHold = opening && completePolicy === 'self' && !(bgFadeComplete && routeCommitted)
  const returnHold = state.phase === 'return-waiting'
  const held = !state.reducedMotion && (holdMotion || soloOpenHold || returnHold)
  const initial = state.reducedMotion
    ? boxStyle(destination, opening ? 0.72 : 1)
    : opening
      ? boxStyle(source, 1)
      : boxStyle(destination, 1)
  const animate = held
    ? boxStyle(holdRect, 1)
    : returning
      ? boxStyle(target, reducedOpacity)
      : boxStyle(destination, 1)
  const containStyle: CSSProperties = {
    contain: 'layout paint style',
    borderRadius: destination.radius,
  }
  // The sidebar tree sits on a card, the article rail tree is bare. The card
  // background must vanish FIRST (quickly), then the bare tree glides over, so
  // the background never trails behind or pops at the handoff.
  const motionDuration = held ? 0 : slideDuration
  // Fade the card background on its own quick clock, independent of the slide.
  // On open it dissolves while the tree is still held at the source, so the bare
  // tree glides over without dragging a background rectangle behind it. On
  // return the tree glides back bare and the card background only fades in as
  // the tree lands (i.e. once the slide is actually running, near its end).
  const bgFadeDuration = state.reducedMotion ? motionDuration : 0.12
  const chromeInitial = opening ? 1 : 0
  const chromeAnimate = opening ? 0 : returning ? (held ? 0 : 1) : 0
  const bgDelay = opening ? 0 : returning ? Math.max(0, motionDuration - bgFadeDuration) : 0
  const sourcePad = opening ? 16 : 0
  const destinationPad = opening ? 0 : 16
  const padInitial = sourcePad
  const padAnimate = held ? sourcePad : destinationPad
  const sourceChrome = opening ? state.snapshot.chrome : 'rail'
  const destinationChrome = opening ? 'rail' : state.snapshot.chrome

  return (
    <motion.div
      data-content-tree-transition-overlay
      data-content-tree-transition-surface
      data-content-tree-transition-phase={state.phase}
      data-content-tree-transition-reduced={state.reducedMotion ? 'true' : 'false'}
      data-content-tree-transition-conceal={concealDestination ? 'true' : 'false'}
      aria-hidden="true"
      className="pointer-events-none fixed z-40 overflow-hidden"
      style={containStyle}
      initial={initial}
      animate={animate}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{
        duration: motionDuration,
        ease: CONTENT_TREE_TRANSITION_EASE,
      }}
      onAnimationComplete={() => {
        if (held || completePolicy === 'card-sequence') {
          return
        }

        if (opening) {
          onOpenMotionComplete()
          return
        }

        if (returning) {
          onReturnMotionComplete()
        }
      }}
    >
      <motion.div
        aria-hidden="true"
        className={`${widgetCardClass} absolute inset-0`}
        style={{ borderRadius: destination.radius }}
        initial={{ opacity: chromeInitial }}
        animate={{ opacity: chromeAnimate }}
        transition={{ duration: bgFadeDuration, delay: bgDelay, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (opening) {
            setBgFadeComplete(true)
          }
        }}
      />
      <motion.div
        className="relative h-full"
        initial={{ padding: padInitial }}
        animate={{ padding: padAnimate }}
        transition={{ duration: motionDuration, ease: CONTENT_TREE_TRANSITION_EASE }}
      >
        <ContentTree
          chrome={held ? sourceChrome : destinationChrome}
          flight
          interactive={false}
          locale={getLocaleFromPathname(state.snapshot.targetPath)}
          nodes={state.snapshot.nodes}
          openFolderPaths={state.snapshot.openFolderPaths}
        />
      </motion.div>
    </motion.div>
  )
}

export default function ContentTreeTransitionOverlay({
  state,
  concealDestination,
  holdMotion = false,
  slideDuration,
  completePolicy = 'self',
  onOpenMotionComplete,
  onReturnMotionComplete,
}: {
  state: ContentTreeTransitionState
  concealDestination: boolean
  holdMotion?: boolean
  slideDuration?: number
  completePolicy?: ContentTreeCompletePolicy
  onOpenMotionComplete: () => void
  onReturnMotionComplete: () => void
}) {
  const visible = visibleState(state)
  const resolvedSlideDuration =
    slideDuration ??
    (visible
      ? getContentTreeSlideDuration({
          phase: visible.phase,
          companion: false,
          reducedMotion: visible.reducedMotion,
        })
      : 0)

  return (
    <AnimatePresence>
      {visible && (
        <TreeSurface
          key={`${visible.snapshot.sourcePath}:${visible.snapshot.targetPath}`}
          concealDestination={concealDestination}
          completePolicy={completePolicy}
          holdMotion={holdMotion}
          slideDuration={resolvedSlideDuration}
          state={visible}
          onOpenMotionComplete={onOpenMotionComplete}
          onReturnMotionComplete={onReturnMotionComplete}
        />
      )}
    </AnimatePresence>
  )
}
