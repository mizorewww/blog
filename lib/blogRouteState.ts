import { locales, stripLocaleFromPathname } from '@/lib/i18n'

export type BlogMotionContext = {
  previousCardTop: number | null
  previousScrollY: number | null
  previousUrl?: string | null
}

export type BlogHistoryState = {
  blogListReturn?: {
    postPath?: string
    previousCardTop?: number | null
    previousScrollY?: number | null
    previousUrl?: string | null
  }
}

type PendingBlogNavigationMotion = BlogMotionContext & {
  motion: 'expand' | 'collapse'
  postPath: string
  targetPath: string
  createdAt: number
}

export type PendingBlogCollapseMotion = BlogMotionContext & {
  postPath: string
}

let pendingBlogNavigationMotion: PendingBlogNavigationMotion | null = null
const PENDING_MOTION_MAX_AGE = 4000
const PENDING_MOTION_STORAGE_KEY = 'mizore:pending-blog-navigation-motion'
const LIST_RETURN_STORAGE_KEY = 'mizore:blog-list-return-contexts'

type StoredBlogListReturnContexts = Record<string, BlogMotionContext>

function readPendingBlogNavigationMotion() {
  if (typeof window === 'undefined') {
    return pendingBlogNavigationMotion
  }

  try {
    const value = window.sessionStorage.getItem(PENDING_MOTION_STORAGE_KEY)

    if (!value) {
      return pendingBlogNavigationMotion
    }

    return JSON.parse(value) as PendingBlogNavigationMotion
  } catch {
    return pendingBlogNavigationMotion
  }
}

function writePendingBlogNavigationMotion(value: PendingBlogNavigationMotion) {
  pendingBlogNavigationMotion = value

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(PENDING_MOTION_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Session storage is a best-effort guard against losing motion context between renders.
  }
}

function clearPendingBlogNavigationMotion() {
  pendingBlogNavigationMotion = null

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(PENDING_MOTION_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup failures; the age check still prevents stale motion.
  }
}

function readBlogListReturnContexts(): StoredBlogListReturnContexts {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const value = window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY)
    return value ? (JSON.parse(value) as StoredBlogListReturnContexts) : {}
  } catch {
    return {}
  }
}

function writeBlogListReturnContexts(contexts: StoredBlogListReturnContexts) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(LIST_RETURN_STORAGE_KEY, JSON.stringify(contexts))
  } catch {
    // Session storage is only used to restore nicer route changes.
  }
}

export function setBlogListReturnContext(postPath: string, context: BlogMotionContext) {
  writeBlogListReturnContexts({
    ...readBlogListReturnContexts(),
    [postPath]: context,
  })
}

export function getStoredBlogListReturnContext(postPath: string): BlogMotionContext | null {
  return readBlogListReturnContexts()[postPath] || null
}

export function clearBlogListReturnContext(postPath: string) {
  const contexts = readBlogListReturnContexts()
  delete contexts[postPath]
  writeBlogListReturnContexts(contexts)
}

export function normalizePathname(pathname: string) {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const withoutTrailingSlash = normalized.replace(/\/+$/, '')

  return withoutTrailingSlash || '/'
}

export function isHomePath(pathname: string) {
  const currentPath = normalizePathname(pathname)

  return currentPath === '/' || locales.some((locale) => currentPath === `/${locale}`)
}

export function isBlogPostPath(pathname: string) {
  const strippedPath = normalizePathname(stripLocaleFromPathname(pathname))

  return (
    strippedPath !== '/' &&
    strippedPath !== '/categories' &&
    !strippedPath.startsWith('/categories/') &&
    strippedPath !== '/tags' &&
    !strippedPath.startsWith('/tags/')
  )
}

export function getBlogListReturnContext(
  state: unknown,
  postPath: string
): BlogMotionContext | null {
  const listReturn = (state as BlogHistoryState | null)?.blogListReturn

  if (!listReturn || listReturn.postPath !== postPath) {
    return getStoredBlogListReturnContext(postPath)
  }

  return {
    previousCardTop:
      typeof listReturn.previousCardTop === 'number' ? listReturn.previousCardTop : null,
    previousScrollY:
      typeof listReturn.previousScrollY === 'number' ? listReturn.previousScrollY : null,
    previousUrl: typeof listReturn.previousUrl === 'string' ? listReturn.previousUrl : null,
  }
}

function isCurrentListReturnUrl(previousUrl: string | null | undefined) {
  if (typeof window === 'undefined' || typeof previousUrl !== 'string') {
    return false
  }

  try {
    const url = new URL(previousUrl, window.location.origin)

    return (
      url.origin === window.location.origin &&
      url.pathname === window.location.pathname &&
      url.search === window.location.search &&
      url.hash === window.location.hash
    )
  } catch {
    return false
  }
}

function clearBlogListReturnFromHistoryState() {
  if (typeof window === 'undefined') {
    return
  }

  const state = window.history.state

  if (typeof state !== 'object' || state === null || !('blogListReturn' in state)) {
    return
  }

  const nextState = { ...(state as BlogHistoryState & Record<string, unknown>) }

  delete nextState.blogListReturn

  window.history.replaceState(nextState, '', window.location.href)
}

function buildPendingCollapseMotion(
  postPath: string,
  context: BlogMotionContext
): PendingBlogCollapseMotion {
  return {
    postPath,
    previousCardTop: context.previousCardTop,
    previousScrollY: context.previousScrollY,
    previousUrl: context.previousUrl,
  }
}

export function consumeCurrentBlogListReturnContext(
  postPaths: string[]
): PendingBlogCollapseMotion | null {
  if (typeof window === 'undefined') {
    return null
  }

  const state = window.history.state as BlogHistoryState | null
  const statePostPath = state?.blogListReturn?.postPath

  if (typeof statePostPath === 'string' && postPaths.includes(statePostPath)) {
    const context = getBlogListReturnContext(state, statePostPath)

    if (context && isCurrentListReturnUrl(context.previousUrl)) {
      clearBlogListReturnContext(statePostPath)
      clearBlogListReturnFromHistoryState()
      return buildPendingCollapseMotion(statePostPath, context)
    }
  }

  const storedContexts = readBlogListReturnContexts()

  for (const postPath of postPaths) {
    const context = storedContexts[postPath]

    if (context && isCurrentListReturnUrl(context.previousUrl)) {
      clearBlogListReturnContext(postPath)
      clearBlogListReturnFromHistoryState()
      return buildPendingCollapseMotion(postPath, context)
    }
  }

  return null
}

export function setPendingBlogNavigationMotion(
  postPath: string,
  targetPath: string,
  context: BlogMotionContext
) {
  writePendingBlogNavigationMotion({
    ...context,
    motion: 'expand',
    postPath,
    targetPath,
    createdAt: Date.now(),
  })
}

export function setPendingBlogCollapseMotion(
  postPath: string,
  targetPath: string,
  context: BlogMotionContext
) {
  writePendingBlogNavigationMotion({
    ...context,
    motion: 'collapse',
    postPath,
    targetPath,
    createdAt: Date.now(),
  })
}

function getPendingTargetPathname(targetPath: string) {
  return normalizePathname(decodeURI(new URL(targetPath, window.location.origin).pathname))
}

export function consumePendingBlogNavigationMotion(postPath: string): BlogMotionContext | null {
  const pendingMotion = readPendingBlogNavigationMotion()

  if (typeof window === 'undefined' || !pendingMotion) {
    return null
  }

  const currentPath = normalizePathname(decodeURI(window.location.pathname))
  const targetPath = getPendingTargetPathname(pendingMotion.targetPath)
  const isExpired = Date.now() - pendingMotion.createdAt > PENDING_MOTION_MAX_AGE
  const isMatchingNavigation =
    pendingMotion.motion !== 'collapse' &&
    pendingMotion.postPath === postPath &&
    targetPath === currentPath

  if (isExpired || !isMatchingNavigation) {
    if (isExpired) {
      clearPendingBlogNavigationMotion()
    }
    return null
  }

  clearPendingBlogNavigationMotion()

  return {
    previousCardTop: pendingMotion.previousCardTop,
    previousScrollY: pendingMotion.previousScrollY,
    previousUrl: pendingMotion.previousUrl,
  }
}

export function consumePendingBlogCollapseMotion(
  postPaths: string[]
): PendingBlogCollapseMotion | null {
  const pendingMotion = readPendingBlogNavigationMotion()

  if (typeof window === 'undefined' || !pendingMotion) {
    return null
  }

  const currentPath = normalizePathname(decodeURI(window.location.pathname))
  const targetPath = getPendingTargetPathname(pendingMotion.targetPath)
  const isExpired = Date.now() - pendingMotion.createdAt > PENDING_MOTION_MAX_AGE
  const isMatchingNavigation =
    pendingMotion.motion === 'collapse' &&
    postPaths.includes(pendingMotion.postPath) &&
    targetPath === currentPath

  if (isExpired || !isMatchingNavigation) {
    if (isExpired) {
      clearPendingBlogNavigationMotion()
    }
    return null
  }

  clearPendingBlogNavigationMotion()

  return {
    postPath: pendingMotion.postPath,
    previousCardTop: pendingMotion.previousCardTop,
    previousScrollY: pendingMotion.previousScrollY,
    previousUrl: pendingMotion.previousUrl,
  }
}
