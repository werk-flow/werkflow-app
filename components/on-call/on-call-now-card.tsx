'use client';

import type { ReactElement } from 'react';
import { Phone, Siren } from 'lucide-react';

import { LiveRouteRefresh } from '@/components/shared/live-route-refresh';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TextLink } from '@/components/ui/text-link';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
import { isOnCallAt, shiftPhase } from '@/lib/on-call/rules';
import type { OnCallOverview, OnCallShift } from '@/lib/on-call/types';

import { phoneHref, shiftSpanLabel } from './on-call-labels';

/**
 * „Bereitschaft jetzt“ for every role: who is on call now with phone and
 * handover note, and the caller's own coming shifts. The minute tick moves a
 * shift from planned to running without a new read.
 */
export function OnCallNowCard({
  overview,
  canPlan,
}: {
  overview: OnCallOverview;
  /** Admin and Büro get the way to the planning. */
  canPlan: boolean;
}): ReactElement {
  const now = new Date(useWallClockTick(60_000));
  const current = overview.shifts.filter((shift) => isOnCallAt(shift, now));
  const own = overview.shifts.filter(
    (shift) =>
      shiftPhase(shift, now) === 'planned' &&
      shift.members.some((member) => member.employeeRecordId === overview.ownEmployeeRecordId),
  );
  return (
    <Card>
      <LiveRouteRefresh tables={['on_call_shifts']} />
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
}

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
              <span className="text-sm text-muted-foreground">Keine Telefonnummer hinterlegt</span>
            )}
          </li>
        ))}
      </ul>
      {shift.handoverNote && <p className="whitespace-pre-line text-sm">{shift.handoverNote}</p>}
    </li>
  );
}
