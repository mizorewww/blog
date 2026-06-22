'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BlogListPost } from '@/lib/listPosts'
import { getPreloadedPostBody, preloadPostBody } from '@/lib/postBodyPreload'

export function usePostBody(post: BlogListPost) {
  const mountedRef = useRef(false)
  const [preloadedBodyCode, setPreloadedBodyCode] = useState<string | null>(() =>
    getPreloadedPostBody(post.path)
  )

  const prefetchPost = useCallback(() => {
    if (post.bodyCode) {
      return
    }

    const cachedBodyCode = getPreloadedPostBody(post.path)

    if (cachedBodyCode) {
      setPreloadedBodyCode(cachedBodyCode)
      return
    }

    void preloadPostBody(post.path).then((preloadedCode) => {
      if (mountedRef.current && preloadedCode) {
        setPreloadedBodyCode(preloadedCode)
      }
    })
  }, [post.bodyCode, post.path])

  useEffect(() => {
    mountedRef.current = true
    prefetchPost()

    return () => {
      mountedRef.current = false
    }
  }, [prefetchPost])

  return {
    bodyCode: post.bodyCode || preloadedBodyCode,
    isPreloaded: Boolean(preloadedBodyCode && !post.bodyCode),
    prefetchPost,
    preloadedBodyCode,
    setPreloadedBodyCode,
  }
}
