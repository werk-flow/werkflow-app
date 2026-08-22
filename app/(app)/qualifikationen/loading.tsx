import { QualifikationenContentSkeleton } from '@/components/loading-states/qualifikationen-page-skeleton';

export default function QualificationsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Qualifikationen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deine Teams, Fähigkeiten und Zertifizierungen im Überblick.
        </p>
      </header>
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <QualifikationenContentSkeleton />
      </main>
    </div>
  );
}
