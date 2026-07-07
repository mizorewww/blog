import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Plain wrapper for each post card. No Motion layout animation —
 * cards below the expanded card follow the CollapsiblePanel's height
 * change naturally via CSS flow. This is smoother and more reliable
 * than layout="position", which never fired because CollapsiblePanel
 * animates via WAAPI (no React re-render between frames).
 */
export default function PostLayoutMotion({
  children,
  className,
  postPath,
}: {
  children: ReactNode
  className?: string
  postPath: string
}) {
  return (
    <div data-post-shell={postPath} className={cn(className)}>
      {children}
    </div>
  )
}
