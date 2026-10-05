import { Skeleton } from '@/components/ui/skeleton';
import type { CalendarNavigationView } from '@/lib/calendar/navigation';

// View tabs strip plus the timeline grid. The grid scrolls inside its own
// region like the live calendar, so the page body never widens on phones.
export function KalenderContentSkeleton({
  withTabs = true,
  view = 'week',
}: { withTabs?: boolean; view?: CalendarNavigationView } = {}) {
  return (
    <div className="flex h-full flex-col" role="status" aria-label="Kalender wird geladen">
      {withTabs && (
        <div className="border-b px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-9 w-full max-w-[340px]" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto" aria-hidden="true">
        {view !== 'month' && (
          <div className="space-y-4 px-4 py-3 sm:hidden">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ))}
          </div>
        )}
        {view === 'month' ? (
          <div className="grid min-w-[560px] grid-cols-7">
            {Array.from({ length: 42 }, (_, index) => (
              <div key={index} className="h-24 space-y-3 border-b border-r p-2">
                <Skeleton className="h-3 w-5" />
                {index % 4 === 0 && <Skeleton className="h-6 w-full" />}
              </div>
            ))}
          </div>
        ) : (
          <div className="hidden sm:block">
            <div className="sticky top-0 z-10 bg-background border-b">
              <div className="flex">
                <div className="w-40 shrink-0 border-r bg-muted/30 px-3 py-2">
                  <Skeleton className="h-4 w-20" />
                </div>
                <div className="flex-1 h-8 bg-muted/10" />
              </div>
            </div>
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex border-b">
                  <div className="w-40 shrink-0 border-r px-3 py-4 space-y-2">
                    <Skeleton className="h-5 w-28" />
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                  <div className="grid min-w-[560px] flex-1 grid-cols-7 divide-x">
                    {Array.from({ length: 7 }, (_, column) => (
                      <div key={column} className="h-20 p-2">
                        {column === i && (
                          <Skeleton className={view === 'day' ? 'h-10 w-full' : 'h-14 w-full'} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
