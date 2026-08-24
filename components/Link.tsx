/* eslint-disable jsx-a11y/anchor-has-content */
import { AnchorHTMLAttributes } from 'react'
import NextLink from 'next/link'
import { cn } from '@/lib/utils'

function isStaticAssetPath(href: string) {
  return (
    href === '/feed.xml' ||
    href === '/robots.txt' ||
    href === '/sitemap.xml' ||
    href.startsWith('/static/') ||
    href.startsWith('/_next/')
  )
}

const CustomLink = ({
  className,
  href = '',
  replace,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { replace?: boolean }) => {
  const isInternalLink = href && href.startsWith('/')
  const isAnchorLink = href && href.startsWith('#')
  const linkClassName = cn('break-words', className)

  if (isInternalLink && !isStaticAssetPath(href)) {
    return <NextLink className={linkClassName} href={href} replace={replace} {...rest} />
  }

  if (isInternalLink || isAnchorLink) {
    return <a className={linkClassName} href={href} {...rest} />
  }

  return (
    <a className={linkClassName} target="_blank" rel="noopener noreferrer" href={href} {...rest} />
  )
}

export default CustomLink
