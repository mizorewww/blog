type ImageList = string | string[] | null | undefined

const HTTP_URL_PATTERN = /^https?:\/\//i

export function toAbsoluteUrl(url: string, siteUrl: string) {
  if (HTTP_URL_PATTERN.test(url)) {
    return url
  }

  return new URL(url.startsWith('/') ? url : `/${url}`, siteUrl).toString()
}

function normalizeImages(image?: string | null, images?: ImageList, fallback?: string) {
  const imageList = Array.isArray(images) ? images : typeof images === 'string' ? [images] : []
  const candidates = [image, ...imageList]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)

  const uniqueImages = Array.from(new Set(candidates))
  return uniqueImages.length > 0 ? uniqueImages : fallback ? [fallback] : []
}

export function getPostImageUrls({
  image,
  images,
  fallback,
  siteUrl,
}: {
  image?: string | null
  images?: ImageList
  fallback?: string
  siteUrl: string
}) {
  return normalizeImages(image, images, fallback).map((url) => toAbsoluteUrl(url, siteUrl))
}
