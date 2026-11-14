'use client';

import { memo, useEffect, useState, type ReactElement } from 'react';
import { Phone, Siren } from 'lucide-react';

import { OnCallNowSkeleton } from '@/components/loading-states/on-call-now-skeleton';
import { useOrganization } from '@/components/organization/organization-context';
import { StaleRegion } from '@/components/shared/stale-region';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionError } from '@/components/ui/section-error';
import { TextLink } from '@/components/ui/text-link';
import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import { isOnCallAt, nextShiftChange, shiftPhase } from '@/lib/on-call/rules';
import type { OnCallOverview, OnCallShift } from '@/lib/on-call/types';
import { isManagerRole } from '@/lib/roles';

import { phoneHref, shiftSpanLabel } from './on-call-labels';

/**
 * „Bereitschaft jetzt“ for every member of the active organization. The card
 * reads on mount and on every change of a shift or a person, over GET and
 * outside the dashboard's server render: the clock actions render the
 * dashboard again, and none of them changes who is on call.
 */
export function OnCallNowCard(): ReactElement | null {
  const { activeOrg } = useOrganization();
  if (!activeOrg) return null;
  return (
    <OnCallNow
      key={activeOrg.orgId}
      organizationId={activeOrg.orgId}
      canPlan={isManagerRole(activeOrg.role)}
    />
  );
}

function OnCallNow({
  organizationId,
  canPlan,
}: {
  organizationId: string;
  /** Admin and Büro get the way to the planning. */
  canPlan: boolean;
}): ReactElement {
  const live = useLiveView<OnCallOverview>({
    tables: ['on_call_shifts', 'profiles', 'employee_records'],
    read: async ({ signal }) => {
      const result = await readInBackground('on-call-overview', { organizationId }, signal);
      return result.success ? { ok: true, data: result.overview } : { ok: false, error: result.error };
    },
  });
  if (live.data) {
    // A failed refresh keeps the last names and numbers visible, marked stale with a retry.
    return (
      <StaleRegion stale={live.isStale} onRetry={live.refresh}>
        <OnCallNowContent overview={live.data} canPlan={canPlan} />
      </StaleRegion>
    );
  }
  if (!live.isStale) return <OnCallNowSkeleton />;
  return (
    <SectionError
      title="Die Bereitschaft konnte nicht geladen werden"
      onRetry={() => void live.refresh()}
      retryPending={live.isRefreshing}
    >
      Wer gerade Bereitschaft hat, ist gerade nicht abrufbar. Versuche es in einem Moment erneut.
    </SectionError>
  );
}

/** setTimeout holds at most 2^31 - 1 ms; a later change waits in steps. */
const LONGEST_WAIT_MS = 2_147_483_647;

/**
 * The instant the card shows, renewed when a shown shift starts or ends. Who
 * is on call changes only there, so the card renders no minute tick: a field
 * worker's dashboard stays still while the clock runs.
 */
function useNowUntilShiftsChange(overview: OnCallOverview): number {
  const [now, setNow] = useState(() => Date.now());
  const next = nextShiftChange([...overview.shifts, ...overview.ownNext], new Date(now));
  useEffect(() => {
    if (next === null) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(next - Date.now(), 0), LONGEST_WAIT_MS),
    );
    return () => window.clearTimeout(timer);
  }, [next, now]);
  return now;
}

/**
 * Who is on call now with phone and handover note, and the caller's own coming
 * shifts. Memoized: the live view re-renders its shell whenever a sheet opens
 * or closes, as around every clock action, while the shown shifts stay the same.
 */
const OnCallNowContent = memo(function OnCallNowContent({
  overview,
  canPlan,
}: {
  overview: OnCallOverview;
  canPlan: boolean;
}): ReactElement {
  const now = new Date(useNowUntilShiftsChange(overview));
  const current = overview.shifts.filter((shift) => isOnCallAt(shift, now));
  const own = overview.ownNext.filter((shift) => shiftPhase(shift, now) === 'planned');
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Siren className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg">Bereitschaft jetzt</CardTitle>
            <CardDescription>Wer außerhalb der Arbeitszeit erreichbar ist.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">Gerade hat niemand Bereitschaft.</p>
        ) : (
          <ul className="space-y-3">
            {current.map((shift) => (
              <CurrentShift key={shift.id} shift={shift} />
            ))}
          </ul>
        )}
        {own.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Deine nächste Bereitschaft</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {own.map((shift) => (
                <li key={shift.id} className="tabular-nums">
                  {shiftSpanLabel(shift)}
                  {shift.label ? ` · ${shift.label}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canPlan && <TextLink href="/service/bereitschaft">Bereitschaft planen</TextLink>}
      </CardContent>
    </Card>
  );
});

function CurrentShift({ shift }: { shift: OnCallShift }): ReactElement {
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {shift.label ? `${shift.label} · ` : ''}
        {shiftSpanLabel(shift)}
      </p>
      <ul className="space-y-2">
        {shift.members.map((member) => (
          <li key={member.employeeRecordId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{member.name}</span>
            {member.phone ? (
              <a
                href={phoneHref(member.phone)}
                className="inline-flex min-h-11 items-center gap-2 text-sm text-primary-text tabular-nums hover:underline"
              >
                <Phone className="size-4" aria-hidden="true" />
                {member.phone}
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">Telefonnummer fehlt</span>
            )}
          </li>
        ))}
      </ul>
      {shift.handoverNote && <p className="whitespace-pre-line text-sm">{shift.handoverNote}</p>}
    </li>
  );
}
