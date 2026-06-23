import type { BlogListPost } from '@/lib/listPosts'
import { normalizePathname } from '@/lib/blogRouteState'

export const POSTS_PER_BATCH = 5

export type MotionPhase = 'idle' | 'positioning' | 'expanding' | 'collapsing-prep' | 'collapsing'

export function getExpandedPathFromPathname(posts: BlogListPost[], pathname: string) {
  const currentPath = normalizePathname(decodeURI(pathname))
  const matchingPost = posts.find((post) => normalizePathname(`/${post.path}`) === currentPath)

  return matchingPost?.path || null
}

export function getInitialVisibleCount(
  posts: BlogListPost[],
  initialDisplayCount: number,
  expandedPath?: string | null
) {
  const expandedIndex = expandedPath ? posts.findIndex((post) => post.path === expandedPath) : -1

  return Math.max(initialDisplayCount || POSTS_PER_BATCH, POSTS_PER_BATCH, expandedIndex + 1)
}
