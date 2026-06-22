import { getIconComponent, toIconComponentName } from '@/lib/icons'
import type { LucideProps } from 'lucide-react'

type IconProps = Omit<LucideProps, 'ref'> & {
  decorative?: boolean
  inlineSpacing?: boolean
  label?: string
  name: string
}

export default function Icon({
  name,
  label,
  decorative = !label,
  inlineSpacing = true,
  className = '',
  size = 16,
  strokeWidth = 2,
  ...props
}: IconProps) {
  const componentName = toIconComponentName(name)
  const IconComponent = getIconComponent(name)

  return (
    <IconComponent
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={!decorative ? label || componentName : undefined}
      className={`inline-block shrink-0 align-[-0.125em] ${inlineSpacing ? 'mx-1' : ''} ${className}`}
      focusable="false"
      size={size}
      strokeWidth={strokeWidth}
      {...props}
    />
  )
}
