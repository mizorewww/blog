import type { ComponentPropsWithoutRef } from 'react'

export default function MDXImage({ alt, ...props }: ComponentPropsWithoutRef<'img'>) {
  // Markdown images do not carry dimensions, so Next Image is not a safe default here.
  // A missing alt is left undefined so jsx-a11y/alt-text surfaces it during content review.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} loading="lazy" decoding="async" {...props} />
}
