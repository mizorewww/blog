import { widgetCardClass } from '@/components/ui/styles'
import type { ReactNode } from 'react'

export default function BlogWidgetCard({
  title,
  children,
  className = '',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      data-blog-widget-card
      className={`${widgetCardClass} px-4 py-4 sm:px-5 sm:py-5 ${className}`}
    >
      <h2 className="mb-3 text-sm font-medium text-slate-500 dark:text-white/55">{title}</h2>
      {children}
    </section>
  )
}
