'use client'

import type { AnimationPlaybackControls } from 'motion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import { animataPostDuration } from '@/components/animata/motion'
import type { BlogListPost } from '@/lib/listPosts'
import {
  getExpandedPathFromPathname,
  getInitialVisibleCount,
  POSTS_PER_BATCH,
  type MotionPhase,
} from '@/lib/blogExpansionState'
import {
  consumeCurrentBlogListReturnContext,
  consumePendingBlogCollapseMotion,
  consumePendingBlogNavigationMotion,
  getBlogListReturnContext,
  type BlogMotionContext,
} from '@/lib/blogRouteState'
import {
  animatePostTopTo,
  animateScrollTo,
  getExpandedTargetOffset,
  getMainColumnHeight,
  getMissingScrollRunway,
  getPostShell,
  holdPostTop,
  prefersReducedMotion,
  setPostTop,
  setScrollY,
} from '@/lib/postLayout'

const SCROLL_CONTROL_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
])

function isScrollControlKey(event: KeyboardEvent) {
  return SCROLL_CONTROL_KEYS.has(event.key)
}

function getExpandedPathFromLocation(posts: BlogListPost[]) {
  if (typeof window === 'undefined') {
    return null
  }

  return getExpandedPathFromPathname(posts, window.location.pathname)
}

function stopMotion(control: AnimationPlaybackControls | null) {
  control?.stop()
}

type MotionRefs = {
  bodyExpansionTimer: MutableRefObject<number | null>
  frame: MutableRefObject<number | null>
  scrollControl: MutableRefObject<AnimationPlaybackControls | null>
  userCancelledMotion: MutableRefObject<boolean>
}

type MotionSetters = {
  setVisibleCount: Dispatch<SetStateAction<number>>
  setExpandedPath: Dispatch<SetStateAction<string | null>>
  setMotionPhase: Dispatch<SetStateAction<MotionPhase>>
  setMotionPath: Dispatch<SetStateAction<string | null>>
  setMotionMinHeight: Dispatch<SetStateAction<number | null>>
}

function useMotionRefs(): MotionRefs {
  const bodyExpansionTimer = useRef<number | null>(null)
  const frame = useRef<number | null>(null)
  const scrollControl = useRef<AnimationPlaybackControls | null>(null)
  const userCancelledMotion = useRef(false)

  return useMemo(
    () => ({ bodyExpansionTimer, frame, scrollControl, userCancelledMotion }),
    [bodyExpansionTimer, frame, scrollControl, userCancelledMotion]
  )
}

function useClearMotionTimers(refs: MotionRefs) {
  return useCallback(() => {
    if (refs.bodyExpansionTimer.current !== null) {
      window.clearTimeout(refs.bodyExpansionTimer.current)
      refs.bodyExpansionTimer.current = null
    }

    if (refs.frame.current !== null) {
      window.cancelAnimationFrame(refs.frame.current)
      refs.frame.current = null
    }

    stopMotion(refs.scrollControl.current)
    refs.scrollControl.current = null
  }, [refs])
}

function useExpandMotion({
  posts,
  setters,
  refs,
  clearMotionTimers,
}: {
  posts: BlogListPost[]
  setters: MotionSetters
  refs: MotionRefs
  clearMotionTimers: () => void
}) {
  const finishExpansion = useCallback(
    (postPath: string) => {
      const targetTop = getExpandedTargetOffset()

      flushSync(() => {
        setters.setMotionPhase('idle')
        setters.setMotionPath(postPath)
        setters.setMotionMinHeight(null)
      })
      refs.userCancelledMotion.current = false
      holdPostTop(postPath, targetTop, refs.scrollControl, () => {
        if (!refs.userCancelledMotion.current) {
          setPostTop(postPath, targetTop)
        }
      })
    },
    [refs, setters]
  )

  const startBodyExpansion = useCallback(
    (postPath: string) => {
      flushSync(() => {
        setters.setExpandedPath(postPath)
        setters.setMotionPhase('expanding')
      })
      setPostTop(postPath, getExpandedTargetOffset())

      const complete = () => {
        refs.bodyExpansionTimer.current = null
        finishExpansion(postPath)
      }

      if (prefersReducedMotion()) {
        complete()
        return
      }

      refs.bodyExpansionTimer.current = window.setTimeout(complete, animataPostDuration * 1000 + 80)
    },
    [finishExpansion, refs, setters]
  )

  const positionThenExpandPost = useCallback(
    (post: BlogListPost, context: BlogMotionContext) => {
      clearMotionTimers()

      const nextVisibleCount = posts.findIndex((item) => item.path === post.path) + 1
      const targetTop = getExpandedTargetOffset()
      const mainColumnHeight = getMainColumnHeight()

      flushSync(() => {
        setters.setMotionMinHeight(mainColumnHeight)
        setters.setVisibleCount((count) => Math.max(count, nextVisibleCount))
        setters.setMotionPath(post.path)
        setters.setExpandedPath(null)
        setters.setMotionPhase('positioning')
      })

      const extraScrollRunway = getMissingScrollRunway(post.path, targetTop)
      if (extraScrollRunway > 0 && mainColumnHeight) {
        flushSync(() => {
          setters.setMotionMinHeight(mainColumnHeight + extraScrollRunway)
        })
      }

      const shell = getPostShell(post.path)
      const startTop = shell?.getBoundingClientRect().top ?? context.previousCardTop ?? targetTop
      const completePositioning = () => {
        setPostTop(post.path, targetTop)
        startBodyExpansion(post.path)
      }

      refs.userCancelledMotion.current = false
      animatePostTopTo(post.path, startTop, targetTop, refs.scrollControl, () => {
        if (refs.userCancelledMotion.current) {
          return
        }

        completePositioning()
      })
    },
    [clearMotionTimers, posts, refs, setters, startBodyExpansion]
  )

  return { positionThenExpandPost }
}

function useCollapseMotion({
  posts,
  setters,
  refs,
  clearMotionTimers,
}: {
  posts: BlogListPost[]
  setters: MotionSetters
  refs: MotionRefs
  clearMotionTimers: () => void
}) {
  const getSavedScrollTargetTop = useCallback(
    (postPath: string, previousScrollY: number | null) => {
      if (typeof previousScrollY !== 'number') {
        return null
      }

      const shell = getPostShell(postPath)

      if (!shell) {
        return null
      }

      return shell.getBoundingClientRect().top + window.scrollY - previousScrollY
    },
    []
  )

  const getCollapsedTargetTop = useCallback(
    (post: BlogListPost, context: BlogMotionContext) => {
      const savedScrollTargetTop = getSavedScrollTargetTop(post.path, context.previousScrollY)

      if (savedScrollTargetTop !== null) {
        return savedScrollTargetTop
      }

      if (context.previousCardTop !== null) {
        return context.previousCardTop
      }

      const postIndex = posts.findIndex((item) => item.path === post.path)

      if (postIndex <= 0) {
        return getExpandedTargetOffset()
      }

      const shell = getPostShell(post.path)
      const shellHeight = shell?.getBoundingClientRect().height || 0
      const targetOffset = getExpandedTargetOffset()

      return Math.max(targetOffset, (window.innerHeight - shellHeight) / 2)
    },
    [getSavedScrollTargetTop, posts]
  )

  const collapsePost = useCallback(
    (post: BlogListPost, context: BlogMotionContext, startTopOverride?: number) => {
      clearMotionTimers()

      const nextVisibleCount = posts.findIndex((item) => item.path === post.path) + 1

      flushSync(() => {
        setters.setVisibleCount((count) => Math.max(count, nextVisibleCount))
        setters.setMotionPath(post.path)
        setters.setExpandedPath(null)
        setters.setMotionPhase('collapsing-prep')
      })

      const startTop =
        startTopOverride ??
        getPostShell(post.path)?.getBoundingClientRect().top ??
        getExpandedTargetOffset()
      const targetTop = getCollapsedTargetTop(post, context)
      const restorePreviousScrollY = () => {
        if (typeof context.previousScrollY === 'number') {
          setScrollY(context.previousScrollY)
        }
      }

      setPostTop(post.path, startTop)

      refs.frame.current = window.requestAnimationFrame(() => {
        refs.frame.current = null

        flushSync(() => {
          setters.setMotionPhase('collapsing')
        })
        setPostTop(post.path, startTop)

        refs.userCancelledMotion.current = false
        animatePostTopTo(post.path, startTop, targetTop, refs.scrollControl, () => {
          if (refs.userCancelledMotion.current) {
            return
          }

          setPostTop(post.path, targetTop)
          flushSync(() => {
            setters.setMotionPhase('idle')
            setters.setMotionPath(null)
          })
          refs.frame.current = window.requestAnimationFrame(() => {
            refs.frame.current = null
            restorePreviousScrollY()
          })
        })
      })
    },
    [clearMotionTimers, getCollapsedTargetTop, posts, refs, setters]
  )

  return { collapsePost }
}

function useSettleCurrentRoute({
  posts,
  initialDisplayCount,
  setters,
}: {
  posts: BlogListPost[]
  initialDisplayCount: number
  setters: MotionSetters
}) {
  return useCallback(() => {
    const nextExpandedPath = getExpandedPathFromLocation(posts)

    flushSync(() => {
      setters.setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
      setters.setExpandedPath(nextExpandedPath)
      setters.setMotionPath(nextExpandedPath)
      setters.setMotionMinHeight(null)
      setters.setMotionPhase('idle')
    })
  }, [initialDisplayCount, posts, setters])
}

function useMotionCancellation({
  refs,
  clearMotionTimers,
  settleCurrentRouteAfterUserCancel,
}: {
  refs: MotionRefs
  clearMotionTimers: () => void
  settleCurrentRouteAfterUserCancel: () => void
}) {
  const cancelActiveMotionFromUserInput = useCallback(() => {
    if (
      !refs.scrollControl.current &&
      refs.bodyExpansionTimer.current === null &&
      refs.frame.current === null
    ) {
      return
    }

    refs.userCancelledMotion.current = true
    clearMotionTimers()
    settleCurrentRouteAfterUserCancel()
  }, [clearMotionTimers, refs, settleCurrentRouteAfterUserCancel])

  useEffect(() => {
    const cancelOnKey = (event: KeyboardEvent) => {
      if (isScrollControlKey(event)) {
        cancelActiveMotionFromUserInput()
      }
    }
    const cancelOnScrollIntent = () => cancelActiveMotionFromUserInput()

    window.addEventListener('wheel', cancelOnScrollIntent, { passive: true })
    window.addEventListener('touchstart', cancelOnScrollIntent, { passive: true })
    window.addEventListener('touchmove', cancelOnScrollIntent, { passive: true })
    window.addEventListener('keydown', cancelOnKey)

    return () => {
      window.removeEventListener('wheel', cancelOnScrollIntent)
      window.removeEventListener('touchstart', cancelOnScrollIntent)
      window.removeEventListener('touchmove', cancelOnScrollIntent)
      window.removeEventListener('keydown', cancelOnKey)
    }
  }, [cancelActiveMotionFromUserInput])

  return { cancelActiveMotionFromUserInput }
}

function useManualScrollRestoration() {
  useEffect(() => {
    if (!('scrollRestoration' in window.history)) {
      return
    }

    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'

    return () => {
      window.history.scrollRestoration = previousScrollRestoration
    }
  }, [])
}

export function useBlogExpansionState({
  initialDisplayCount,
  initialExpandedPath,
  pathname,
  posts,
}: {
  initialDisplayCount: number
  initialExpandedPath: string | null
  pathname: string
  posts: BlogListPost[]
}) {
  const pendingInitialContextRef = useRef<BlogMotionContext | null | undefined>(undefined)

  if (pendingInitialContextRef.current === undefined) {
    pendingInitialContextRef.current = initialExpandedPath
      ? consumePendingBlogNavigationMotion(initialExpandedPath)
      : null
  }

  const shouldAnimateInitialExpansion = Boolean(pendingInitialContextRef.current)
  const [visibleCount, setVisibleCount] = useState(
    getInitialVisibleCount(posts, initialDisplayCount, initialExpandedPath)
  )
  const [expandedPath, setExpandedPath] = useState<string | null>(
    shouldAnimateInitialExpansion ? null : initialExpandedPath
  )
  const [motionPhase, setMotionPhase] = useState<MotionPhase>('idle')
  const [motionPath, setMotionPath] = useState<string | null>(
    shouldAnimateInitialExpansion ? null : initialExpandedPath
  )
  const [motionMinHeight, setMotionMinHeight] = useState<number | null>(null)

  const refs = useMotionRefs()
  const clearMotionTimers = useClearMotionTimers(refs)
  const setters = useMemo<MotionSetters>(
    () => ({
      setVisibleCount,
      setExpandedPath,
      setMotionPhase,
      setMotionPath,
      setMotionMinHeight,
    }),
    [setExpandedPath, setMotionMinHeight, setMotionPath, setMotionPhase, setVisibleCount]
  )
  const settleCurrentRouteAfterUserCancel = useSettleCurrentRoute({
    posts,
    initialDisplayCount,
    setters,
  })
  useMotionCancellation({
    refs,
    clearMotionTimers,
    settleCurrentRouteAfterUserCancel,
  })
  const { positionThenExpandPost } = useExpandMotion({ posts, setters, refs, clearMotionTimers })
  const { collapsePost } = useCollapseMotion({ posts, setters, refs, clearMotionTimers })
  useManualScrollRestoration()

  const loadMorePosts = useCallback(() => {
    setVisibleCount((count) => Math.min(count + POSTS_PER_BATCH, posts.length))
  }, [posts.length])

  const scrollToTop = useCallback(() => {
    clearMotionTimers()
    refs.userCancelledMotion.current = false
    animateScrollTo(0, refs.scrollControl)
  }, [clearMotionTimers, refs])

  useLayoutEffect(() => {
    const nextExpandedPath = getExpandedPathFromPathname(posts, pathname)
    const postPaths = posts.map((post) => post.path)
    const pendingInitialContext =
      pendingInitialContextRef.current ||
      (nextExpandedPath ? consumePendingBlogNavigationMotion(nextExpandedPath) : null)
    const pendingCollapseContext = nextExpandedPath
      ? null
      : consumePendingBlogCollapseMotion(postPaths) ||
        consumeCurrentBlogListReturnContext(postPaths)

    if (pendingInitialContext && nextExpandedPath) {
      const post = posts.find((item) => item.path === nextExpandedPath)

      pendingInitialContextRef.current = null
      clearMotionTimers()
      setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
      setExpandedPath(null)
      setMotionPath(null)
      setMotionMinHeight(null)
      setMotionPhase('idle')

      if (post) {
        refs.frame.current = window.requestAnimationFrame(() => {
          refs.frame.current = null
          positionThenExpandPost(post, pendingInitialContext)
        })
      }

      return
    }

    if (pendingCollapseContext) {
      const post = posts.find((item) => item.path === pendingCollapseContext.postPath)

      pendingInitialContextRef.current = null
      clearMotionTimers()
      setExpandedPath(null)
      setMotionPath(null)
      setMotionMinHeight(null)
      setMotionPhase('idle')

      if (post) {
        refs.frame.current = window.requestAnimationFrame(() => {
          refs.frame.current = null
          collapsePost(post, pendingCollapseContext, getExpandedTargetOffset())
        })
      }

      return
    }

    clearMotionTimers()
    setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
    setExpandedPath(nextExpandedPath)
    setMotionPath(nextExpandedPath)
    setMotionMinHeight(null)
    setMotionPhase('idle')
  }, [
    clearMotionTimers,
    collapsePost,
    initialDisplayCount,
    pathname,
    positionThenExpandPost,
    posts,
    refs,
  ])

  useEffect(() => {
    const syncExpandedPath = (event?: Event) => {
      const nextExpandedPath = getExpandedPathFromLocation(posts)

      if (!nextExpandedPath && expandedPath) {
        const expandedPost = posts.find((post) => post.path === expandedPath)
        const eventState = event && 'state' in event ? event.state : undefined

        if (expandedPost) {
          collapsePost(
            expandedPost,
            getBlogListReturnContext(eventState, expandedPath) || {
              previousCardTop: null,
              previousScrollY: null,
            }
          )
          return
        }
      }

      clearMotionTimers()
      setVisibleCount(getInitialVisibleCount(posts, initialDisplayCount, nextExpandedPath))
      setExpandedPath(nextExpandedPath)
      setMotionPath(nextExpandedPath)
      setMotionMinHeight(null)
      setMotionPhase('idle')
    }

    window.addEventListener('popstate', syncExpandedPath)

    return () => window.removeEventListener('popstate', syncExpandedPath)
  }, [clearMotionTimers, collapsePost, expandedPath, initialDisplayCount, posts])

  useEffect(() => {
    return () => clearMotionTimers()
  }, [clearMotionTimers])

  return {
    expandedPath,
    loadMorePosts,
    motionMinHeight,
    motionPath,
    motionPhase,
    scrollToTop,
    visibleCount,
  }
}
