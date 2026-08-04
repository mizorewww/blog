import { Skeleton } from '@/components/animata/Skeleton'

export default function ArticleRouteSkeleton() {
  return (
    <div
      data-article-route-skeleton
      className="article-shell mx-auto w-full pb-16 sm:pt-6"
      aria-hidden
    >
      <div className="article-surface-layout">
        <div
          data-article-skeleton-surface
          className="article-reading-surface dark:bg-surface-card-dark relative z-0 min-w-0 overflow-hidden bg-white shadow-sm ring-1 shadow-slate-300/70 ring-slate-950/5 dark:shadow-black/20 dark:ring-white/10"
        >
          <header className="article-header min-w-0">
            <div
              data-article-skeleton-cover
              className="dark:bg-surface-cover-dark relative aspect-[2/1] overflow-hidden bg-slate-100 sm:aspect-[2.8/1]"
            >
              <Skeleton className="h-full w-full rounded-none" />
              <Skeleton className="absolute top-3 right-3 h-11 w-11 rounded-full" />
            </div>

            <div className="article-content-rail space-y-5 pt-6 pb-8 sm:pt-8 min-[90rem]:pb-0">
              <Skeleton className="h-11 w-5/6" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-32" />
            </div>
          </header>

          <section
            data-article-skeleton-mobile-toc
            className="article-toc-mobile dark:border-border-subtle-dark w-full overflow-hidden border-y border-slate-200 min-[90rem]:hidden"
          >
            <div className="article-content-rail py-3">
              <Skeleton className="h-6 w-32" />
            </div>
          </section>

          <div data-article-skeleton-body className="article-content-rail space-y-4 pt-6 pb-10">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-56 w-full" />
          </div>
        </div>

        <aside
          data-article-skeleton-desktop-toc
          className="article-toc-desktop hidden space-y-3 min-[90rem]:block"
        >
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/5" />
        </aside>
      </div>
    </div>
  )
}
