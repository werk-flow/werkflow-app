'use client';

import { CalendarClock, ChevronRight, ListTodo, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { memo, type ReactElement, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FIELD_WORKER_TARGET_CLASS } from '@/components/ui/field-worker-targets';
import { ListRow } from '@/components/ui/list-row';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import type { ReadFailure } from '@/hooks/use-client-read';
import type { StoredToday } from '@/lib/field-sync/device/today-store';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { formatBerlinTime } from '@/lib/utils';
import type { WorkerStartClockView } from './worker-start-clock';
import { workerStartRow, type WorkerStartRow } from './worker-start-rows';
import { EinsaetzeSkeleton } from './worker-start-skeleton';

// The three parts of a field worker's start page, from what the page hands
// them; worker-start-content.tsx reads the device, the clock and the counts.
// Links skip the prefetch in view: every clock action refreshes this page, and
// a prefetch in view would read each work pack again after it.

function StartSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EinsatzRow({ row }: { row: WorkerStartRow }): ReactElement {
  return (
    <ListRow asChild interactive rowId={row.jobId} className={FIELD_WORKER_TARGET_CLASS}>
      <Link href={row.href} prefetch={false}>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium tabular-nums">{row.time}</p>
          <p className="text-sm">{row.title}</p>
          {row.customer && <p className="truncate text-xs text-muted-foreground">{row.customer}</p>}
          {row.place && <p className="text-xs wrap-anywhere text-muted-foreground">{row.place}</p>}
          {row.nextStep ? (
            <p className="text-xs">
              <span className="text-muted-foreground">Als Nächstes:</span> {row.nextStep}
            </p>
          ) : (
            row.instructionsDone && <p className="text-xs text-muted-foreground">Alle Anweisungen erledigt</p>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </ListRow>
  );
}

/**
 * Today's Einsätze from the phone's snapshot. Without signal the same list stands under
 * „Offline · Stand“. A device that cannot be read shows its failure, never an empty day.
 */
export const WorkerStartEinsaetze = memo(function WorkerStartEinsaetze({
  stored,
  settled,
  ended,
  failure,
  online,
}: {
  stored: StoredToday | null;
  settled: boolean;
  /** A day this page showed has ended; only the next start of the app fetches the new one. */
  ended: boolean;
  failure: ReadFailure | null;
  online: boolean;
}): ReactElement {
  let content: ReactNode;
  if (failure && !stored)
    content = (
      <SectionError title="Deine Einsätze von heute konnten nicht gelesen werden" failure={failure} />
    );
  else if (stored) {
    const { assignments } = stored.snapshot;
    content =
      assignments.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Keine Einsätze heute"
          description="Heute ist nichts für dich geplant."
        />
      ) : (
        <ul className="space-y-3" aria-label="Deine Einsätze heute">
          {assignments.map((assignment) => (
            <li key={assignment.jobId}>
              <EinsatzRow row={workerStartRow(assignment)} />
            </li>
          ))}
        </ul>
      );
  } else if (ended)
    content = (
      <EmptyState
        icon={CalendarClock}
        title="Keine Einsätze mehr auf diesem Gerät"
        description="Der Tag, den dein Gerät gespeichert hatte, ist vorbei. Lade die Seite neu, um deine Einsätze von heute zu holen."
        action={
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Neu laden
          </Button>
        }
      />
    );
  else if (settled && !online)
    content = (
      <EmptyState
        icon={WifiOff}
        title="Keine Einsätze auf diesem Gerät"
        description="Sobald du wieder Netz hast, erscheinen deine Einsätze von heute hier."
      />
    );
  // Until the start page's refresh saved the day; a day it cannot store shows E7's banner above.
  else content = <EinsaetzeSkeleton />;

  return (
    <StartSection id="worker-start-einsaetze" title="Deine Einsätze heute">
      {stored && !online && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          Offline · Stand {formatBerlinTime(stored.confirmedAt)}
        </p>
      )}
      {/* A failed re-read keeps the day it read before, with the failure and its retry above it. */}
      {failure && stored && (
        <SectionError title="Deine Einsätze von heute konnten nicht gelesen werden" failure={failure} />
      )}
      {content}
    </StartSection>
  );
});

/**
 * The clock's state and today's working time as plain elements: the one component that follows
 * the clock calls this, so a clock action renders that component alone.
 */
export function clockLines(view: WorkerStartClockView): ReactElement {
  let status: ReactNode;
  let hours: ReactNode;
  if (view.kind === 'ready') {
    status = <span className="truncate font-medium">{view.status}</span>;
    hours =
      view.workingMinutes === null ? (
        <span className="text-muted-foreground">Deine Stunden von heute siehst du in der Zeiterfassung.</span>
      ) : (
        <span className="tabular-nums text-muted-foreground">
          {view.asOf ? `Heute bis ${formatBerlinTime(view.asOf)} Uhr gearbeitet: ` : 'Heute gearbeitet: '}
          <span className="text-foreground">{formatDuration(view.workingMinutes)}</span>
        </span>
      );
  } else if (view.kind === 'loading') {
    status = <Skeleton className="h-4 w-36" />;
    hours = <Skeleton className="h-4 w-44" />;
  } else {
    // The clock dock shows the failure and its retry; one failure gets one surface.
    status = <span className="text-muted-foreground">Die Uhr ist gerade nicht erreichbar.</span>;
    hours = <span className="text-muted-foreground">Deine Stunden siehst du in der Zeiterfassung.</span>;
  }
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <div className="flex min-h-5 items-center">{status}</div>
      <div className="flex min-h-5 items-center">{hours}</div>
    </div>
  );
}

/** The clock part, linking to the Zeiterfassung; `children` are its `clockLines`. */
export function WorkerStartClock({ children }: { children: ReactNode }): ReactElement {
  return (
    <StartSection id="worker-start-clock" title="Zeiterfassung">
      <ListRow asChild interactive className={FIELD_WORKER_TARGET_CLASS}>
        <Link href="/zeiterfassung" prefetch={false} data-testid="worker-start-clock">
          {children}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </ListRow>
    </StartSection>
  );
}

/** The count of the own open Aufgaben, as a plain element; nothing while none is open. */
export function taskCount(count: number): ReactElement | null {
  return count > 0 ? <span className="text-sm font-medium tabular-nums">{count} offen</span> : null;
}

/** The person's own open Aufgaben, linking to them; `children` is their `taskCount`. */
export function WorkerStartTasks({ children }: { children: ReactNode }): ReactElement {
  return (
    <StartSection id="worker-start-tasks" title="Aufgaben">
      <ListRow asChild interactive className={FIELD_WORKER_TARGET_CLASS}>
        <Link href="/aufgaben" prefetch={false} data-testid="worker-start-tasks">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <ListTodo className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Deine Aufgaben
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {children}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        </Link>
      </ListRow>
    </StartSection>
  );
}
