import {
  ARTICLE_DESKTOP_TOC_BREAKPOINT,
  ARTICLE_SHELL_MAX_WIDTH,
  ARTICLE_TREE_WIDTH,
} from '@/lib/articleLayout'
import {
  ARTICLE_TRANSITION_EASE,
  ARTICLE_TRANSITION_OPEN_DURATION_SECONDS,
  ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS,
  ARTICLE_TRANSITION_RETURN_DURATION_SECONDS,
  getArticleTransitionDestination,
  rectIntersectsViewport,
  type ArticleTransitionGeometry,
  type ArticleTransitionRect,
  type ArticleTransitionViewport,
} from '@/lib/articleTransition'
import { normalizePathname } from '@/lib/blogRouteState'
import {
  collectFolderPaths,
  parseContentTreeNodes,
  type ContentTreeNode,
} from '@/lib/content/contentTree'

export const CONTENT_TREE_TRANSITION_DURATION_SECONDS = ARTICLE_TRANSITION_OPEN_DURATION_SECONDS
export const CONTENT_TREE_TRANSITION_EASE = ARTICLE_TRANSITION_EASE
export const ARTICLE_SURFACE_VEIL_DURATION_SECONDS = 0.2

export function getContentTreeSlideDuration({
  phase,
  companion,
  reducedMotion,
}: {
  phase: ContentTreeTransitionState['phase']
  companion: boolean
  reducedMotion: boolean
}) {
  if (reducedMotion) {
    return ARTICLE_TRANSITION_REDUCED_DURATION_SECONDS
  }

  if (companion && phase === 'returning') {
    return ARTICLE_TRANSITION_RETURN_DURATION_SECONDS
  }

  return CONTENT_TREE_TRANSITION_DURATION_SECONDS
}

const MAX_PATH_LENGTH = 512
const MAX_TREE_NODES = 80

export type ContentTreeChrome = 'sidebar' | 'rail'

export type ContentTreeSnapshot = {
  sourcePath: string
  targetPath: string
  nodes: ContentTreeNode[]
  sourceRect: ArticleTransitionRect
  chrome: ContentTreeChrome
  openFolderPaths: string[]
}

export type ContentTreeTransitionState =
  | { phase: 'idle' }
  | {
      phase: 'opening'
      snapshot: ContentTreeSnapshot
      destination: ArticleTransitionGeometry
      reducedMotion: boolean
      routeCommitted: boolean
      motionCompleted: boolean
    }
  | {
      phase: 'retained'
      snapshot: ContentTreeSnapshot
      destination: ArticleTransitionGeometry
      reducedMotion: boolean
    }
  | {
      phase: 'return-waiting'
      snapshot: ContentTreeSnapshot
      destination: ArticleTransitionGeometry
      reducedMotion: boolean
    }
  | {
      phase: 'returning'
      snapshot: ContentTreeSnapshot
      destination: ArticleTransitionGeometry
      target: ArticleTransitionRect
      reducedMotion: boolean
    }

export type ContentTreeTransitionAction =
  | {
      type: 'open-started'
      snapshot: ContentTreeSnapshot
      viewport: ArticleTransitionViewport
      reducedMotion: boolean
    }
  | { type: 'route-committed'; pathname: string }
  | { type: 'open-motion-completed' }
  | { type: 'return-requested' }
  | { type: 'return-target-resolved'; pathname: string; target: ArticleTransitionRect }
  | { type: 'return-motion-completed' }
  | { type: 'cancelled' }
  | { type: 'viewport-changed' }

export type ContentTreeTransitionStage = 'opening' | 'revealed'

export type ArticleSurfaceVeilState =
  | { phase: 'idle' }
  | {
      phase: 'covering'
      targetPath: string
      rect: ArticleTransitionRect
      reducedMotion: boolean
    }
  | {
      phase: 'revealing'
      targetPath: string
      rect: ArticleTransitionRect
      reducedMotion: boolean
    }

export type ArticleSurfaceVeilAction =
  | {
      type: 'cover-started'
      targetPath: string
      rect: ArticleTransitionRect
      reducedMotion: boolean
    }
  | { type: 'route-committed'; pathname: string }
  | { type: 'reveal-completed' }
  | { type: 'cancelled' }

export const idleContentTreeTransitionState: ContentTreeTransitionState = { phase: 'idle' }
export const idleArticleSurfaceVeilState: ArticleSurfaceVeilState = { phase: 'idle' }

function finite(value: number) {
  return Number.isFinite(value)
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

function countTreeNodes(nodes: ContentTreeNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.kind === 'folder') {
      return total + 1 + countTreeNodes(node.children)
    }

    return total + 1
  }, 0)
}

function parseContentTreeChrome(value: unknown): ContentTreeChrome | null {
  return value === 'sidebar' || value === 'rail' ? value : null
}

function parseOpenFolderPaths(value: unknown, nodes: ContentTreeNode[]): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const allowed = new Set(collectFolderPaths(nodes))
  const seen = new Set<string>()
  const paths: string[] = []

  for (const item of value) {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > MAX_PATH_LENGTH ||
      !allowed.has(item)
    ) {
      return null
    }

    if (!seen.has(item)) {
      seen.add(item)
      paths.push(item)
    }
  }

  return paths
}

export function getContentTreeDestination(
  viewport: ArticleTransitionViewport
): ArticleTransitionGeometry | null {
  if (
    !finite(viewport.width) ||
    !finite(viewport.height) ||
    viewport.width < ARTICLE_DESKTOP_TOC_BREAKPOINT ||
    viewport.height <= 0
  ) {
    return null
  }

  const top = 120
  const shellWidth = Math.min(ARTICLE_SHELL_MAX_WIDTH, viewport.width - 30)
  const left = (viewport.width - shellWidth) / 2 + shellWidth - ARTICLE_TREE_WIDTH
  const height = viewport.height - 136

  if (ARTICLE_TREE_WIDTH <= 0 || height <= 0) {
    return null
  }

  return {
    top,
    left,
    width: ARTICLE_TREE_WIDTH,
    height,
    radius: 8,
  }
}

export function createContentTreeSnapshot(
  input: Partial<ContentTreeSnapshot>,
  viewport: ArticleTransitionViewport
): ContentTreeSnapshot | null {
  const sourcePath = localPath(input.sourcePath)
  const targetPath = localPath(input.targetPath)
  const nodes = parseContentTreeNodes(input.nodes)
  const chrome = parseContentTreeChrome(input.chrome)
  const openFolderPaths = nodes ? parseOpenFolderPaths(input.openFolderPaths, nodes) : null

  if (
    !sourcePath ||
    !targetPath ||
    sourcePath === targetPath ||
    !nodes ||
    nodes.length === 0 ||
    countTreeNodes(nodes) > MAX_TREE_NODES ||
    !chrome ||
    openFolderPaths === null ||
    !isArticleTransitionRect(input.sourceRect) ||
    !rectIntersectsViewport(input.sourceRect, viewport)
  ) {
    return null
  }

  return {
    sourcePath,
    targetPath,
    nodes,
    sourceRect: { ...input.sourceRect },
    chrome,
    openFolderPaths,
  }
}

export function createContentTreeReturnTarget(
  input: Partial<ArticleTransitionRect>,
  viewport: ArticleTransitionViewport
): ArticleTransitionRect | null {
  if (!isArticleTransitionRect(input) || !rectIntersectsViewport(input, viewport)) {
    return null
  }

  return { ...input }
}

export function deriveContentTreeTransitionStage(
  state: ContentTreeTransitionState,
  pathname: string
): ContentTreeTransitionStage | null {
  if (state.phase !== 'opening' && state.phase !== 'retained') {
    return null
  }

  if (state.reducedMotion || normalizePathname(pathname) !== state.snapshot.targetPath) {
    return null
  }

  return state.phase === 'opening' ? 'opening' : 'revealed'
}

export type ContentTreeReturnStage = 'returning'

// While the overlay flies the tree back to the list sidebar, the real sidebar
// tree must stay hidden, otherwise the user sees two trees at once (the static
// real one plus the gliding overlay). The overlay alone represents the tree
// until it lands; the real tree is revealed only when the transition completes.
export function deriveContentTreeReturnStage(
  state: ContentTreeTransitionState,
  pathname: string
): ContentTreeReturnStage | null {
  if (
    (state.phase === 'return-waiting' || state.phase === 'returning') &&
    normalizePathname(pathname) === state.snapshot.sourcePath
  ) {
    return 'returning'
  }

  return null
}

function retainWhenReady(
  state: Extract<ContentTreeTransitionState, { phase: 'opening' }>
): ContentTreeTransitionState {
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

export function contentTreeTransitionReducer(
  state: ContentTreeTransitionState,
  action: ContentTreeTransitionAction
): ContentTreeTransitionState {
  switch (action.type) {
    case 'open-started': {
      const destination = getContentTreeDestination(action.viewport)

      if (!destination) {
        return idleContentTreeTransitionState
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
          return idleContentTreeTransitionState
        }

        return retainWhenReady({ ...state, routeCommitted: true })
      }

      if (state.phase === 'retained' && pathname !== state.snapshot.targetPath) {
        return idleContentTreeTransitionState
      }

      if (state.phase === 'return-waiting' && pathname !== state.snapshot.sourcePath) {
        return idleContentTreeTransitionState
      }

      if (state.phase === 'returning' && pathname !== state.snapshot.sourcePath) {
        return idleContentTreeTransitionState
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
        : idleContentTreeTransitionState
    case 'return-motion-completed':
      return state.phase === 'returning' ? idleContentTreeTransitionState : state
    case 'cancelled':
    case 'viewport-changed':
      return idleContentTreeTransitionState
  }
}

export function articleSurfaceVeilReducer(
  state: ArticleSurfaceVeilState,
  action: ArticleSurfaceVeilAction
): ArticleSurfaceVeilState {
  switch (action.type) {
    case 'cover-started':
      if (action.reducedMotion || !isArticleTransitionRect(action.rect)) {
        return idleArticleSurfaceVeilState
      }

      return {
        phase: 'covering',
        targetPath: normalizePathname(action.targetPath),
        rect: { ...action.rect },
        reducedMotion: false,
      }
    case 'route-committed': {
      if (state.phase !== 'covering') {
        return idleArticleSurfaceVeilState
      }

      if (normalizePathname(action.pathname) !== state.targetPath) {
        return idleArticleSurfaceVeilState
      }

      return {
        phase: 'revealing',
        targetPath: state.targetPath,
        rect: state.rect,
        reducedMotion: state.reducedMotion,
      }
    }
    case 'reveal-completed':
    case 'cancelled':
      return idleArticleSurfaceVeilState
  }
}

export function getArticleSurfaceVeilRect(
  viewport: ArticleTransitionViewport
): ArticleTransitionRect | null {
  const destination = getArticleTransitionDestination(viewport)

  if (!destination) {
    return null
  }

  return {
    top: destination.top,
    left: destination.left,
    width: destination.width,
    height: destination.height,
  }
}
