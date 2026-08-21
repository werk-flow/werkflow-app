import { AufgabenContentSkeleton } from '@/components/loading-states/aufgaben-page-skeleton';

export default function AufgabenLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Aufgaben</h1>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <AufgabenContentSkeleton />
      </div>
    </div>
  );
}
