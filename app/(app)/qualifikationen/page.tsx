import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { OwnQualificationOverview } from '@/components/mitarbeiter/own-qualification-overview';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { QualifikationenContentSkeleton } from '@/components/loading-states/qualifikationen-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { getCachedUser } from '@/lib/data/cached';
import { getOwnQualificationProfile } from '@/lib/qualifications/actions';

// The profile fetch streams behind Suspense so the page frame renders
// immediately instead of blocking on the full qualification profile.
async function QualificationsData() {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) redirect('/login');

  const result = await getOwnQualificationProfile();

  if (!result.success) {
    return (
      <RegionLoadError title="Deine Qualifikationen konnten nicht geladen werden">
        Die Übersicht ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <OwnQualificationOverview profile={result.data} />;
}

export default function QualificationsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Qualifikationen"
        subtitle="Deine Teams, Fähigkeiten und Zertifizierungen im Überblick."
      />
      <PageBody>
        <Suspense fallback={<QualifikationenContentSkeleton />}>
          <QualificationsData />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
