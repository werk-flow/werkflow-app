import { redirect } from 'next/navigation';
import { OwnQualificationOverview } from '@/components/mitarbeiter/own-qualification-overview';
import { getCachedUser } from '@/lib/data/cached';
import { getOwnQualificationProfile } from '@/lib/qualifications/actions';

export default async function QualificationsPage() {
  const { data: { user } } = await getCachedUser();
  if (!user) redirect('/login');

  const result = await getOwnQualificationProfile();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Qualifikationen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deine Teams, Fähigkeiten und Zertifizierungen im Überblick.
        </p>
      </header>
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        {result.success ? (
          <OwnQualificationOverview profile={result.data} />
        ) : (
          <p role="alert" className="text-sm text-destructive">
            Deine Qualifikationen konnten nicht geladen werden.
          </p>
        )}
      </main>
    </div>
  );
}
