export const DESKTOP_EXPANDED_TARGET_OFFSET = 96
export const MOBILE_EXPANDED_TARGET_OFFSET = 88

export function getExpandedTargetOffset() {
  return window.matchMedia('(max-width: 639px)').matches
    ? MOBILE_EXPANDED_TARGET_OFFSET
    : DESKTOP_EXPANDED_TARGET_OFFSET
}

export function setScrollY(top: number) {
  const root = document.documentElement
  const previousScrollBehavior = root.style.scrollBehavior

  root.style.scrollBehavior = 'auto'
  window.scrollTo(0, top)
  root.style.scrollBehavior = previousScrollBehavior
}

export function getPostShell(postPath: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-post-shell]')).find(
    (shell) => shell.dataset.postShell === postPath
  )
}

export function setPostTop(postPath: string, targetTop: number) {
  const shell = getPostShell(postPath)
  if (!shell) return

  const currentTop = shell.getBoundingClientRect().top
  setScrollY(window.scrollY + currentTop - targetTop)
}

export function restorePostListPosition({
  postPath,
  previousCardTop,
  previousScrollY,
}: {
  postPath: string
  previousCardTop: number | null
  previousScrollY: number | null
}) {
  if (typeof previousScrollY === 'number') {
    setScrollY(previousScrollY)
    return
  }

  if (typeof previousCardTop === 'number') {
    setPostTop(postPath, previousCardTop)
  }
}
