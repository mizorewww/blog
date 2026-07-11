import { normalizePathname } from '@/lib/blogRouteState'

export const ARTICLE_TRANSITION_OPEN_DURATION_SECONDS = 0.38
export const ARTICLE_TRANSITION_RETURN_DURATION_SECONDS = 0.34
export const ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS = 0.08
export const ARTICLE_TRANSITION_EXIT_DURATION_SECONDS = 0
export const ARTICLE_TRANSITION_EASE = [0.32, 0.72, 0, 1] as const

const MAX_KEY_LENGTH = 240
const MAX_PATH_LENGTH = 512
const MAX_IMAGE_SRC_LENGTH = 2_048
const MAX_TITLE_LENGTH = 240
const MAX_SUMMARY_LENGTH = 600
const MAX_PRESENTATION_ITEM_LENGTH = 600

export type ArticleTransitionRect = {
  top: number
  left: number
  width: number
  height: number
}

export type ArticleTransitionGeometry = ArticleTransitionRect & {
  radius: number
}

export type ArticleTransitionViewport = {
  width: number
  height: number
}

export type ArticleCardSnapshot = {
  key: string
  sourcePath: string
  targetPath: string
  imageSrc: string
  title: string
  gitUpdated: string
  gitSource: string
  summary: string
  publishedDate: string
  primaryTag: string
  readMore: string
  cardRect: ArticleTransitionRect
  coverRect: ArticleTransitionRect
  radius: number
}

export type ArticleTransitionTarget = {
  cardRect: ArticleTransitionRect
  coverRect: ArticleTransitionRect
  radius: number
}

export type ArticleNavigationIntent =
  | { kind: 'card'; snapshot: ArticleCardSnapshot }
  | { kind: 'fallback'; targetPath: string }
  | { kind: 'cancel' }

export type ArticleTransitionState =
  | { phase: 'idle' }
  | {
      phase: 'opening'
      snapshot: ArticleCardSnapshot
      destination: ArticleTransitionGeometry
      reducedMotion: boolean
      routeCommitted: boolean
      motionCompleted: boolean
    }
  | {
      phase: 'retained'
      snapshot: ArticleCardSnapshot
      destination: ArticleTransitionGeometry
      reducedMotion: boolean
    }
  | {
      phase: 'return-waiting'
      snapshot: ArticleCardSnapshot
      destination: ArticleTransitionGeometry
      reducedMotion: boolean
    }
  | {
      phase: 'returning'
      snapshot: ArticleCardSnapshot
      destination: ArticleTransitionGeometry
      target: ArticleTransitionTarget
      reducedMotion: boolean
    }

export type ArticleTransitionDestinationStage = 'opening' | 'revealed'

export type ArticleTransitionAction =
  | {
      type: 'open-started'
      snapshot: ArticleCardSnapshot
      viewport: ArticleTransitionViewport
      reducedMotion: boolean
    }
  | { type: 'route-committed'; pathname: string }
  | { type: 'open-motion-completed' }
  | { type: 'return-requested' }
  | { type: 'return-target-resolved'; pathname: string; target: ArticleTransitionTarget }
  | { type: 'return-motion-completed' }
  | { type: 'cancelled' }
  | { type: 'viewport-changed' }

export const idleArticleTransitionState: ArticleTransitionState = { phase: 'idle' }

export function deriveArticleTransitionDestinationStage(
  state: ArticleTransitionState,
  pathname: string
): ArticleTransitionDestinationStage | null {
  if (state.phase !== 'opening' && state.phase !== 'retained') {
    return null
  }

  if (state.reducedMotion || normalizePathname(pathname) !== state.snapshot.targetPath) {
    return null
  }

  if (state.phase === 'opening') {
    return 'opening'
  }

  return state.phase === 'retained' ? 'revealed' : null
}

function finite(value: number) {
  return Number.isFinite(value)
}

function boundedText(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().replace(/\s+/g, ' ')

  if ((!allowEmpty && normalized.length === 0) || normalized.length > maxLength) {
    return null
  }

  return normalized
}

function localPath(value: unknown) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    return null
  }

  try {
    const parsed = new URL(value, 'https://transition.invalid')

    if (parsed.origin !== 'https://transition.invalid') {
      return null
    }

    return normalizePathname(parsed.pathname)
  } catch {
    return null
  }
}

function imageSource(value: unknown) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IMAGE_SRC_LENGTH) {
    return null
  }

  try {
    const parsed = new URL(value, 'https://transition.invalid')

    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

function isArticleTransitionRect(value: unknown): value is ArticleTransitionRect {
  if (!value || typeof value !== 'object') {
    return false
  }

  const rect = value as Partial<ArticleTransitionRect>

  return (
    typeof rect.top === 'number' &&
    finite(rect.top) &&
    typeof rect.left === 'number' &&
    finite(rect.left) &&
    typeof rect.width === 'number' &&
    finite(rect.width) &&
    rect.width > 0 &&
    typeof rect.height === 'number' &&
    finite(rect.height) &&
    rect.height > 0
  )
}

export function rectIntersectsViewport(
  rect: ArticleTransitionRect,
  viewport: ArticleTransitionViewport
) {
  return (
    isArticleTransitionRect(rect) &&
    finite(viewport.width) &&
    finite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0 &&
    rect.left < viewport.width &&
    rect.left + rect.width > 0 &&
    rect.top < viewport.height &&
    rect.top + rect.height > 0
  )
}

function coverFitsCard(cardRect: ArticleTransitionRect, coverRect: ArticleTransitionRect) {
  const tolerance = 2

  return (
    coverRect.left >= cardRect.left - tolerance &&
    coverRect.top >= cardRect.top - tolerance &&
    coverRect.left + coverRect.width <= cardRect.left + cardRect.width + tolerance &&
    coverRect.top + coverRect.height <= cardRect.top + cardRect.height + tolerance
  )
}

export function createArticleCardSnapshot(
  input: Partial<ArticleCardSnapshot>,
  viewport: ArticleTransitionViewport
): ArticleCardSnapshot | null {
  const key = boundedText(input.key, MAX_KEY_LENGTH)
  const sourcePath = localPath(input.sourcePath)
  const targetPath = localPath(input.targetPath)
  const imageSrc = imageSource(input.imageSrc)
  const title = boundedText(input.title, MAX_TITLE_LENGTH)
  const gitUpdated = boundedText(input.gitUpdated, MAX_PRESENTATION_ITEM_LENGTH, true)
  const gitSource = boundedText(input.gitSource, MAX_PRESENTATION_ITEM_LENGTH, true)
  const summary = boundedText(input.summary, MAX_SUMMARY_LENGTH, true)
  const publishedDate = boundedText(input.publishedDate, MAX_PRESENTATION_ITEM_LENGTH)
  const primaryTag = boundedText(input.primaryTag, MAX_PRESENTATION_ITEM_LENGTH, true)
  const readMore = boundedText(input.readMore, MAX_PRESENTATION_ITEM_LENGTH)
  const radius = input.radius

  if (
    !key ||
    !sourcePath ||
    !targetPath ||
    sourcePath === targetPath ||
    !imageSrc ||
    !title ||
    gitUpdated === null ||
    gitSource === null ||
    summary === null ||
    !publishedDate ||
    primaryTag === null ||
    !readMore ||
    !isArticleTransitionRect(input.cardRect) ||
    !isArticleTransitionRect(input.coverRect) ||
    !rectIntersectsViewport(input.cardRect, viewport) ||
    !coverFitsCard(input.cardRect, input.coverRect) ||
    typeof radius !== 'number' ||
    !finite(radius) ||
    radius < 0 ||
    radius > 32
  ) {
    return null
  }

  return {
    key,
    sourcePath,
    targetPath,
    imageSrc,
    title,
    gitUpdated,
    gitSource,
    summary,
    publishedDate,
    primaryTag,
    readMore,
    cardRect: { ...input.cardRect },
    coverRect: { ...input.coverRect },
    radius,
  }
}

export function createArticleTransitionTarget(
  input: Partial<ArticleTransitionTarget>,
  viewport: ArticleTransitionViewport
): ArticleTransitionTarget | null {
  if (
    !isArticleTransitionRect(input.cardRect) ||
    !isArticleTransitionRect(input.coverRect) ||
    !rectIntersectsViewport(input.cardRect, viewport) ||
    !coverFitsCard(input.cardRect, input.coverRect) ||
    typeof input.radius !== 'number' ||
    !finite(input.radius) ||
    input.radius < 0 ||
    input.radius > 32
  ) {
    return null
  }

  return {
    cardRect: { ...input.cardRect },
    coverRect: { ...input.coverRect },
    radius: input.radius,
  }
}

export function getArticleTransitionDestination(
  viewport: ArticleTransitionViewport
): ArticleTransitionGeometry | null {
  if (
    !finite(viewport.width) ||
    !finite(viewport.height) ||
    viewport.width < 320 ||
    viewport.height <= 0
  ) {
    return null
  }

  const mobile = viewport.width < 640
  const top = mobile ? 72 : 120
  const width = mobile ? viewport.width : Math.min(780, viewport.width - 30)

  if (width <= 0 || viewport.height <= top) {
    return null
  }

  return {
    top,
    left: (viewport.width - width) / 2,
    width,
    height: viewport.height - top,
    radius: mobile ? 0 : 8,
  }
}

function retainWhenReady(
  state: Extract<ArticleTransitionState, { phase: 'opening' }>
): ArticleTransitionState {
  if (!state.routeCommitted || !state.motionCompleted) {
    return state
  }

  return {
    phase: 'retained',
    snapshot: state.snapshot,
    destination: state.destination,
    reducedMotion: state.reducedMotion,
  }
}

export function articleTransitionReducer(
  state: ArticleTransitionState,
  action: ArticleTransitionAction
): ArticleTransitionState {
  switch (action.type) {
    case 'open-started': {
      const destination = getArticleTransitionDestination(action.viewport)

      if (!destination) {
        return idleArticleTransitionState
      }

      return {
        phase: 'opening',
        snapshot: action.snapshot,
        destination,
        reducedMotion: action.reducedMotion,
        routeCommitted: false,
        motionCompleted: false,
      }
    }
    case 'route-committed': {
      const pathname = normalizePathname(action.pathname)

      if (state.phase === 'opening') {
        if (pathname !== state.snapshot.targetPath) {
          return idleArticleTransitionState
        }

        return retainWhenReady({ ...state, routeCommitted: true })
      }

      if (state.phase === 'retained' && pathname !== state.snapshot.targetPath) {
        return idleArticleTransitionState
      }

      if (state.phase === 'return-waiting' && pathname !== state.snapshot.sourcePath) {
        return idleArticleTransitionState
      }

      if (state.phase === 'returning' && pathname !== state.snapshot.sourcePath) {
        return idleArticleTransitionState
      }

      return state
    }
    case 'open-motion-completed':
      return state.phase === 'opening'
        ? retainWhenReady({ ...state, motionCompleted: true })
        : state
    case 'return-requested':
      return state.phase === 'retained' || state.phase === 'opening'
        ? {
            phase: 'return-waiting',
            snapshot: state.snapshot,
            destination: state.destination,
            reducedMotion: state.reducedMotion,
          }
        : state
    case 'return-target-resolved':
      return state.phase === 'return-waiting' &&
        normalizePathname(action.pathname) === state.snapshot.sourcePath
        ? {
            phase: 'returning',
            snapshot: state.snapshot,
            destination: state.destination,
            target: action.target,
            reducedMotion: state.reducedMotion,
          }
        : idleArticleTransitionState
    case 'return-motion-completed':
      return state.phase === 'returning' ? idleArticleTransitionState : state
    case 'cancelled':
    case 'viewport-changed':
      return idleArticleTransitionState
  }
}
