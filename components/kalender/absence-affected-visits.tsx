'use client';

import { useEffect, useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import type {
  AbsenceAffectedVisits as AffectedVisits,
  AbsenceAffectedVisitsInput,
} from '@/lib/calendar/absence-visits-types';
import { CALENDAR_DISPATCH_STATE_LABELS } from '@/lib/calendar/board';
import { readInBackground } from '@/lib/data/background-read-client';
import { formatGermanDate } from '@/lib/utils';

type AffectedVisitsRead =
  | { state: 'loading' }
  | { state: 'loaded'; result: AffectedVisits }
  | { state: 'failed' };

/** The affected visits of the absence, read once it is saved, with a retry after a failure. */
function useAffectedVisits(absence: AbsenceAffectedVisitsInput) {
  const { employeeRecordId, startDate, endDate } = absence;
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${employeeRecordId}:${startDate}:${endDate ?? 'offen'}:${attempt}`;
  const [settled, setSettled] = useState<{ key: string; read: AffectedVisitsRead } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void readInBackground(
      'absence-affected-visits',
      { employeeRecordId, startDate, endDate },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setSettled({
        key: requestKey,
        read: result.success
          ? { state: 'loaded', result: { visits: result.visits, through: result.through } }
          : { state: 'failed' },
      });
    });
    return () => controller.abort();
  }, [employeeRecordId, startDate, endDate, requestKey]);
  const read: AffectedVisitsRead = settled?.key === requestKey ? settled.read : { state: 'loading' };
  return { read, retry: () => setAttempt((count) => count + 1) };
}

/** „bis 21.11.2026“ for an open end, whose list stops at its lookahead. */
function openEndSuffix(absence: AbsenceAffectedVisitsInput, through: string): string {
  return absence.endDate === null ? ` bis ${formatGermanDate(through)}` : '';
}

/**
 * The planned visits a saved absence takes the person away from, each with
 * its dispatch state and a link to its day on the Plantafel, so the office
 * can rearrange them (walkthrough finding 43). Shown to Admin and Büro only.
 */
export function AbsenceAffectedVisits({
  absence,
}: {
  absence: AbsenceAffectedVisitsInput;
}): React.JSX.Element {
  const headingId = useId();
  const { read, retry } = useAffectedVisits(absence);
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={read.state === 'loading'}
      // A grid child (the dialog body) sizes to its content unless it may shrink.
      className="min-w-0 space-y-2"
      data-absence-affected-visits=""
    >
      <h3 id={headingId} className="text-sm font-medium">
        Betroffene Termine
      </h3>
      {read.state === 'loading' && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {read.state === 'failed' && (
        <SectionError onRetry={retry}>
          Die betroffenen Termine konnten nicht geladen werden. Die Abwesenheit ist gespeichert.
        </SectionError>
      )}
      {read.state === 'loaded' && read.result.visits.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Keine geplanten Termine betroffen{openEndSuffix(absence, read.result.through)}.
        </p>
      )}
      {read.state === 'loaded' && read.result.visits.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            Diese Termine sind geplant{openEndSuffix(absence, read.result.through)}. Plane sie auf der
            Plantafel um.
          </p>
          <ul className="divide-y rounded-lg border">
            {read.result.visits.map((visit) => (
              <li
                key={visit.occurrenceId}
                className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <TextLink href={`/kalender?date=${visit.date}`} className="tabular-nums">
                    {formatGermanDate(visit.date)}
                    {visit.time ? `, ${visit.time} Uhr` : ''}
                  </TextLink>
                  <p className="break-words">
                    {visit.title}
                    {visit.jobNumber && <span className="text-muted-foreground"> · {visit.jobNumber}</span>}
                  </p>
                </div>
                <Badge
                  variant={visit.dispatchState === 'nicht_gesendet' ? 'outline' : 'secondary'}
                  className="shrink-0"
                >
                  Einsatz {CALENDAR_DISPATCH_STATE_LABELS[visit.dispatchState]}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
