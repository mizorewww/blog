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
    <section className={`${widgetCardClass} px-5 py-5 sm:px-6 sm:py-6 ${className}`}>
      <h2 className="mb-5 text-base font-medium text-slate-500 dark:text-white/60">{title}</h2>
      {children}
    </section>
  )
}
