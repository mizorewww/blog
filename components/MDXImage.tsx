import type { ComponentPropsWithoutRef } from 'react'

export default function MDXImage({
  alt,
  className,
  title,
  ...props
}: ComponentPropsWithoutRef<'img'>) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className={['article-image', className].filter(Boolean).join(' ')}
      loading="lazy"
      decoding="async"
      title={title}
      {...props}
    />
  )

  if (typeof title === 'string' && title.trim()) {
    return (
      <figure className="article-figure">
        {image}
        <figcaption>{title}</figcaption>
      </figure>
    )
  }

  // Markdown images do not carry dimensions, so Next Image is not a safe default here.
  // A missing alt is left undefined so jsx-a11y/alt-text surfaces it during content review.
  return image
}
