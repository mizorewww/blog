/* eslint-disable @next/next/no-img-element -- ResponsiveImage emits a <picture> with pre-generated WebP variants and a srcset, which next/image cannot do under static export with images.unoptimized. */
import { cn } from '@/lib/utils'
import { imageDimensions, isLocalImage, responsiveEntry, responsiveSrcset } from '@/lib/images'

type ResponsiveImageProps = {
  src: string
  alt: string
  sizes?: string
  className?: string
  priority?: boolean
  fill?: boolean
  width?: number
  height?: number
}

export default function ResponsiveImage({
  src,
  alt,
  sizes,
  className,
  priority = false,
  fill = false,
  width,
  height,
}: ResponsiveImageProps) {
  const loading = priority ? 'eager' : 'lazy'
  const fetchPriority: 'high' | 'auto' = priority ? 'high' : 'auto'
  const entry = isLocalImage(src) ? responsiveEntry(src) : undefined

  // No manifest entry means the image was not processed by the optimize script
  // (or is remote). Render a plain <img> so no dangling srcset URLs are emit.
  if (!entry) {
    return (
      <img
        src={src}
        alt={alt}
        sizes={sizes}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        width={width}
        height={height}
        className={className}
      />
    )
  }

  const srcset = responsiveSrcset(src)
  const intrinsic = imageDimensions(src)
  const renderWidth = width ?? intrinsic?.width
  const renderHeight = height ?? intrinsic?.height

  const img = fill ? (
    <img
      src={src}
      alt={alt}
      sizes={sizes}
      srcSet={srcset}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      className={cn('h-full w-full object-cover', className)}
    />
  ) : (
    <img
      src={src}
      alt={alt}
      sizes={sizes}
      srcSet={srcset}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      width={renderWidth}
      height={renderHeight}
      className={className}
    />
  )

  return (
    <picture>
      <source type="image/webp" srcSet={srcset} sizes={sizes} />
      {img}
    </picture>
  )
}
