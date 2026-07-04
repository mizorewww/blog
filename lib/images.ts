// Responsive image helpers shared by the runtime <ResponsiveImage> component
// and the build-time variant generator (scripts/optimize-images.mjs).
// RESPONSIVE_WIDTHS must stay in sync with the script.

export const RESPONSIVE_WIDTHS = [400, 640, 768, 1024, 1280] as const

const HTTP_URL_PATTERN = /^https?:\/\//i

export function isLocalImage(src: string): boolean {
  return !HTTP_URL_PATTERN.test(src) && src.startsWith('/')
}

export function responsiveVariant(src: string, width: number): string {
  const dot = src.lastIndexOf('.')

  if (dot <= 0) {
    return `${src}.${width}.webp`
  }

  return `${src.slice(0, dot)}.${width}.webp`
}

export function responsiveSrcset(src: string): string {
  return RESPONSIVE_WIDTHS.map((width) => `${responsiveVariant(src, width)} ${width}w`).join(', ')
}
