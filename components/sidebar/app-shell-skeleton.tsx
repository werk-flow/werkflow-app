import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-page skeleton used as the PPR Suspense fallback for the app layout.
 * This is the static HTML shell that renders instantly before the client
 * provider tree hydrates. It does NOT render {children} because page
 * components need provider context to render.
 */
export function AppShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-background md:flex-row">
      <header className="flex md:hidden items-center justify-between border-b bg-card px-4 py-3 sticky top-0 z-30">
        <div className="h-9 w-9" />
        <Skeleton className="h-7 w-28 rounded" />
        <div className="w-9" />
      </header>
      <aside className="hidden md:flex h-full w-64 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center justify-center px-4 py-5">
          <Skeleton className="h-9 w-40 rounded" />
        </div>
        <div className="border-t" />
        <div className="p-4">
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="border-t" />
        <nav className="flex-1 p-4">
          <div className="space-y-1">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
              </div>
            ))}
          </div>
        </nav>
        <div className="mt-auto border-t">
          <div className="flex items-center gap-3 p-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 min-w-0">
              <Skeleton className="h-4 w-24 mb-1 rounded" />
              <Skeleton className="h-3 w-32 rounded" />
            </div>
          </div>
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-hidden">
        <main className="h-full overflow-hidden p-4 sm:p-6">
          <div className="space-y-4">
            <Skeleton className="h-8 w-48 rounded" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </main>
      </div>
    </div>
  );
}
