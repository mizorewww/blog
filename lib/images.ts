// Responsive image helpers shared by the runtime <ResponsiveImage> component
// and the build-time variant generator (scripts/optimize-images.mjs).
// RESPONSIVE_WIDTHS must stay in sync with the script.

import { imageManifest, type ImageEntry } from '@/lib/generated/image-manifest'

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

/**
 * Returns the manifest entry for a local image, or undefined when the image has
 * not been processed by the optimize script yet. Callers must fall back to a
 * plain <img> when undefined so no dangling srcset URLs are emitted.
 */
export function responsiveEntry(src: string): ImageEntry | undefined {
  return imageManifest[src]
}

export function responsiveSrcset(src: string): string {
  const entry = responsiveEntry(src)
  const widths = entry ? entry.widths : []

  return widths.map((width) => `${responsiveVariant(src, width)} ${width}w`).join(', ')
}

export function imageDimensions(src: string): { width: number; height: number } | undefined {
  const entry = responsiveEntry(src)

  if (!entry || !entry.width || !entry.height) {
    return undefined
  }

  return { width: entry.width, height: entry.height }
}
