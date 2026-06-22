import { locales, stripLocaleFromPathname } from '@/lib/i18n'

export const BLOG_PATH_CHANGE_EVENT = 'blog-pathchange'

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
  }
}

type PendingBlogNavigationMotion = BlogMotionContext & {
  postPath: string
  targetPath: string
  createdAt: number
}

let pendingBlogNavigationMotion: PendingBlogNavigationMotion | null = null
const PENDING_MOTION_MAX_AGE = 4000
const PENDING_MOTION_STORAGE_KEY = 'mizore:pending-blog-navigation-motion'

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
    return null
  }

  return {
    previousCardTop:
      typeof listReturn.previousCardTop === 'number' ? listReturn.previousCardTop : null,
    previousScrollY:
      typeof listReturn.previousScrollY === 'number' ? listReturn.previousScrollY : null,
    previousUrl: null,
  }
}

export function setPendingBlogNavigationMotion(
  postPath: string,
  targetPath: string,
  context: BlogMotionContext
) {
  writePendingBlogNavigationMotion({
    ...context,
    postPath,
    targetPath,
    createdAt: Date.now(),
  })
}

export function consumePendingBlogNavigationMotion(postPath: string): BlogMotionContext | null {
  const pendingMotion = readPendingBlogNavigationMotion()

  if (typeof window === 'undefined' || !pendingMotion) {
    return null
  }

  const currentPath = normalizePathname(decodeURI(window.location.pathname))
  const targetPath = normalizePathname(decodeURI(pendingMotion.targetPath))
  const isExpired = Date.now() - pendingMotion.createdAt > PENDING_MOTION_MAX_AGE
  const isMatchingNavigation = pendingMotion.postPath === postPath && targetPath === currentPath

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

export function notifyBlogPathChange() {
  window.dispatchEvent(new Event(BLOG_PATH_CHANGE_EVENT))
}
