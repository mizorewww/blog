import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[8px] bg-slate-200/80 dark:bg-white/10',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-[animata-shimmer_1.6s_ease-in-out_infinite] before:bg-linear-to-r before:from-transparent before:via-white/50 before:to-transparent motion-reduce:before:animate-none dark:before:via-white/10',
        className
      )}
    />
  )
}
