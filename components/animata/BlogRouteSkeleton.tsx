import { Skeleton } from '@/components/animata/Skeleton'

export default function BlogRouteSkeleton() {
  return (
    <div className="blog-frame mx-auto grid w-full gap-y-5 px-4 pt-2 pb-16 sm:px-0 xl:grid-cols-[23fr_minmax(0,54fr)_23fr] xl:gap-x-[var(--blog-gap)]">
      <aside className="hidden space-y-5 xl:block">
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </aside>
      <section className="blog-main-column space-y-6">
        <div className="dark:bg-surface-card-dark overflow-hidden rounded-[8px] bg-white shadow-[0_14px_36px_rgba(21,30,43,0.07)] dark:shadow-none">
          <Skeleton className="aspect-[2.65/1] rounded-none" />
          <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <div className="flex items-center justify-between pt-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        </div>
        <Skeleton className="h-40" />
      </section>
      <aside className="hidden space-y-5 xl:block">
        <Skeleton className="h-80" />
      </aside>
    </div>
  )
}
