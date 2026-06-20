import type { ComponentPropsWithoutRef } from 'react'

export default function MDXImage({ alt = '', ...props }: ComponentPropsWithoutRef<'img'>) {
  // Markdown images do not carry dimensions, so Next Image is not a safe default here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} loading="lazy" decoding="async" {...props} />
}
