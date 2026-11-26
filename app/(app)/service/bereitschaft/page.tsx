import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { OnCallWeekSkeleton } from '@/components/loading-states/on-call-skeletons';
import { OnCallWeekContent } from '@/components/on-call/on-call-week-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { isValidIsoDate } from '@/lib/calendar/date-range';
import { readOnCallWeek } from '@/lib/on-call/reads';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The office plans Bereitschaft here (werk-flow/werkflow-planning#469); every
// member sees who is on call on the dashboard, so an employee goes there.
export default function OnCallPage({ searchParams = Promise.resolve({}) }: { searchParams?: SearchParams }) {
  return (
    <Suspense fallback={<OnCallWeekSkeleton />}>
      <OnCallWeek searchParams={searchParams} />
    </Suspense>
  );
}

async function OnCallWeek({ searchParams }: { searchParams: SearchParams }) {
  const { membership } = await resolvePageMembership();
  if (!membership) redirect('/dashboard');
  if (!isManagerRole(membership.role)) redirect('/dashboard');
  const { woche } = await searchParams;
  const day = typeof woche === 'string' && isValidIsoDate(woche) ? woche : null;
  const result = await readOnCallWeek(membership.orgId, day);
  if (!result.success) {
    return (
      <RegionLoadError title="Die Bereitschaft konnte nicht geladen werden">
        Die Übersicht ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <OnCallWeekContent key={membership.orgId} organizationId={membership.orgId} week={result.week} />;
}
