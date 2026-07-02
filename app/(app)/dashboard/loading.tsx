import { DashboardContentSkeleton } from '@/components/loading-states/dashboard-content-skeleton';

export default function DashboardLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="sticky top-0 z-10 flex items-center border-b bg-background px-4 py-3 sm:px-6 sm:py-4 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Dashboard</h1>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <DashboardContentSkeleton />
      </div>
    </div>
  );
}
