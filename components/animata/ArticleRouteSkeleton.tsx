import { Skeleton } from '@/components/animata/Skeleton'

export default function ArticleRouteSkeleton() {
  return (
    <div
      data-article-route-skeleton
      className="article-shell mx-auto w-full px-4 pt-4 pb-16 sm:px-5 sm:pt-6 lg:px-0"
      aria-hidden
    >
      <div className="article-reading-grid">
        <header className="article-header min-w-0 space-y-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-11 w-5/6" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="aspect-[16/9] w-full" />
        </header>
        <section className="article-toc-mobile lg:hidden">
          <Skeleton className="h-12 w-full" />
        </section>
        <div className="article-body space-y-4">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-56 w-full" />
        </div>
        <aside className="article-toc-desktop hidden space-y-3 lg:block">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/5" />
        </aside>
      </div>
    </div>
  )
}
