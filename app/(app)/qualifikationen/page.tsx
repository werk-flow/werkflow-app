import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { OwnQualificationOverview } from '@/components/mitarbeiter/own-qualification-overview';
import { ErrorText } from '@/components/ui/error-text';
import { QualifikationenContentSkeleton } from '@/components/loading-states/qualifikationen-page-skeleton';
import { getCachedUser } from '@/lib/data/cached';
import { getOwnQualificationProfile } from '@/lib/qualifications/actions';

// The profile fetch streams behind Suspense so the page frame renders
// immediately instead of blocking on the full qualification profile.
async function QualificationsData() {
  const { data: { user } } = await getCachedUser();
  if (!user) redirect('/login');

  const result = await getOwnQualificationProfile();

  if (!result.success) {
    return (
      <ErrorText>Deine Qualifikationen konnten nicht geladen werden.</ErrorText>
    );
  }
  return <OwnQualificationOverview profile={result.data} />;
}

export default function QualificationsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Qualifikationen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deine Teams, Fähigkeiten und Zertifizierungen im Überblick.
        </p>
      </header>
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <Suspense fallback={<QualifikationenContentSkeleton />}>
          <QualificationsData />
        </Suspense>
      </main>
    </div>
  );
}
