'use client';

import {
  CalendarClock,
  ChevronRight,
  MapPin,
  Navigation,
  Phone,
  UserRound,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { StandaloneTitle } from '@/components/shared/standalone-screen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SectionError } from '@/components/ui/section-error';
import { useClientRead } from '@/hooks/use-client-read';
import { offlineViewAt } from '@/lib/field-sync/device/today-address';
import { readTodayOnDevice, type StoredToday } from '@/lib/field-sync/device/today-store';
import { TODAY_WIPE_KEY } from '@/lib/field-sync/device/today-wipe';
import type { FieldSyncTodayAssignment } from '@/lib/field-sync/today-snapshot';
import { jobDetailHref } from '@/lib/jobs/routes';
import { logError } from '@/lib/logging';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { formatBerlinTime } from '@/lib/utils';

// What a phone shows without signal (decision record 0010, "Device data"):
// today's assignments and each one's work pack, read from the snapshot the
// device keeps, with when the server last confirmed it. It reads the device
// only; the server never sees this view. Which part an address shows is
// today-address.ts's rule. Links are plain document links, so each one opens
// without signal the same way.

function hrefOf(assignment: FieldSyncTodayAssignment): string {
  return jobDetailHref(
    { id: assignment.jobId, jobNumber: assignment.jobNumber },
    assignment.project
      ? { id: assignment.project.projectNumber, projectNumber: assignment.project.projectNumber }
      : null,
  );
}

function offlineVisitLabel(visit: FieldSyncTodayAssignment['visits'][number]): string {
  return visit.startAt && visit.endAt
    ? `${formatBerlinTime(visit.startAt)}–${formatBerlinTime(visit.endAt)} Uhr`
    : 'Ganztägig';
}

/** The first line of every offline view: that this is the device's copy, and from when. */
function FreshnessLine({ confirmedAt }: { confirmedAt: string }): ReactElement {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
      data-testid="offline-today-stand"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      Offline · Stand {formatBerlinTime(confirmedAt)}
    </p>
  );
}

function TodayList({ assignments }: { assignments: FieldSyncTodayAssignment[] }): ReactElement {
  if (assignments.length === 0)
    return (
      <EmptyState
        icon={CalendarClock}
        title="Keine Einsätze für heute"
        description="Neue Einsätze siehst du, sobald du wieder Netz hast."
      />
    );
  return (
    <ul className="space-y-3" aria-label="Deine Einsätze heute">
      {assignments.map((assignment) => (
        <li key={assignment.jobId}>
          <ListRow asChild interactive>
            <a href={hrefOf(assignment)}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{assignment.title}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {assignment.visits.map(offlineVisitLabel).join(', ')}
                  {assignment.siteAddress ? ` · ${assignment.siteAddress}` : ''}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          </ListRow>
        </li>
      ))}
    </ul>
  );
}

function OfflineFact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {children}
      </div>
    </div>
  );
}

function PackFacts({ assignment }: { assignment: FieldSyncTodayAssignment }): ReactElement {
  const phone = assignment.contactPhone ?? assignment.customerPhone;
  return (
    <section
      className="rounded-lg border bg-card p-4 shadow-xs wrap-anywhere sm:p-5"
      aria-labelledby="offline-pack-facts"
    >
      <h2 id="offline-pack-facts" className="text-base font-semibold">
        Vor dem Einsatz
      </h2>
      <div className="mt-3 space-y-3">
        <OfflineFact icon={CalendarClock} label="Termin">
          <p className="mt-0.5 text-sm font-medium tabular-nums">
            {assignment.visits.map(offlineVisitLabel).join(', ')}
          </p>
          {assignment.plannedWorkingMinutes ? (
            <p className="text-xs text-muted-foreground">
              Geplant: {formatDuration(assignment.plannedWorkingMinutes)}
            </p>
          ) : null}
        </OfflineFact>
        <OfflineFact icon={UserRound} label="Kontakt">
          <p className="mt-0.5 text-sm font-medium">
            {assignment.contactName ?? assignment.customerName ?? 'Nicht hinterlegt'}
          </p>
          {assignment.contactRole && (
            <p className="text-xs text-muted-foreground">{assignment.contactRole}</p>
          )}
          {assignment.contactName && assignment.customerName && (
            <p className="text-xs text-muted-foreground">{assignment.customerName}</p>
          )}
        </OfflineFact>
        <OfflineFact icon={MapPin} label="Einsatzort">
          <p className="mt-0.5 text-sm font-medium">{assignment.siteName ?? 'Einsatzort'}</p>
          {assignment.siteAddress && (
            <p className="text-sm text-muted-foreground">{assignment.siteAddress}</p>
          )}
          {assignment.accessNotes && (
            <p className="mt-1 text-sm">
              <span className="font-medium">Zugang:</span> {assignment.accessNotes}
            </p>
          )}
        </OfflineFact>
      </div>
      {assignment.requestedOutcome && (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Arbeitsziel</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{assignment.requestedOutcome}</p>
        </div>
      )}
      {(phone || assignment.siteAddress) && (
        <div className="mt-3 flex gap-2 border-t pt-3">
          {phone && (
            <Button asChild className="min-h-11 min-w-0 flex-1 px-2 sm:flex-none sm:px-4">
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
                <Phone className="size-4" />
                Anrufen
              </a>
            </Button>
          )}
          {assignment.siteAddress && (
            <Button
              asChild
              variant={phone ? 'outline' : 'default'}
              className="min-h-11 min-w-0 flex-1 px-2 sm:flex-none sm:px-4"
            >
              <a href={`geo:0,0?q=${encodeURIComponent(assignment.siteAddress)}`}>
                <Navigation className="size-4" />
                Route
              </a>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function PackInstructions({ instructions }: { instructions: FieldSyncTodayAssignment['instructions'] }) {
  return (
    <section
      className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
      aria-labelledby="offline-pack-instructions"
    >
      <h2 id="offline-pack-instructions" className="text-base font-semibold">
        Anweisungen
      </h2>
      {instructions.length === 0 ? (
        <EmptyState size="compact" title="Keine Anweisungen für diesen Auftrag." className="mt-2" />
      ) : (
        <ul className="mt-3 divide-y">
          {instructions.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                {item.groupLabel && <p className="text-xs text-muted-foreground">{item.groupLabel}</p>}
                <p className="text-sm">{item.content}</p>
                {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                {item.required && <Badge variant="outline">Pflicht</Badge>}
                {item.done && <Badge variant="success">Erledigt</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PackView({ assignment }: { assignment: FieldSyncTodayAssignment }): ReactElement {
  return (
    <div className="space-y-4" data-testid="offline-work-pack">
      <div>
        <StandaloneTitle>{assignment.title}</StandaloneTitle>
        <p className="text-sm text-muted-foreground">Auftrag {assignment.jobNumber ?? 'Ohne Nummer'}</p>
      </div>
      <PackFacts assignment={assignment} />
      <PackInstructions instructions={assignment.instructions} />
      <Button asChild variant="link" className="px-0">
        <a href="/dashboard">Alle Einsätze von heute</a>
      </Button>
    </div>
  );
}

function OfflineDayView({ stored, pathname }: { stored: StoredToday; pathname: string }): ReactElement {
  const { jobNumber, assignment } = offlineViewAt(pathname, stored.snapshot.assignments);
  return (
    <div className="w-full max-w-2xl space-y-4 text-left" data-testid="offline-today">
      <FreshnessLine confirmedAt={stored.confirmedAt} />
      {assignment ? (
        <PackView assignment={assignment} />
      ) : (
        <>
          <StandaloneTitle>Heute</StandaloneTitle>
          {jobNumber && (
            <p className="text-sm text-muted-foreground">
              Dieser Auftrag ist ohne Netz nicht auf deinem Gerät. Ohne Netz siehst du nur deine Einsätze von
              heute.
            </p>
          )}
          <TodayList assignments={stored.snapshot.assignments} />
        </>
      )}
    </div>
  );
}

/** The longest delay `setTimeout` keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** The wipe signal any tab gave last, or null when localStorage cannot be read. */
function wipeSignal(): string | null {
  try {
    return localStorage.getItem(TODAY_WIPE_KEY) ?? '';
  } catch {
    // Fails closed: the store shows no day then either (today-store.ts).
    return null;
  }
}

/**
 * Ends the shown day when it can no longer stand. A sign-out or organization switch in another
 * tab, from mount on, and a return from the back-forward cache, where no storage event arrives,
 * drop it at once and read again; the former person's day never stays on screen while the next
 * read runs. Berlin midnight (`validUntil`) reads again, and the read drops the ended day.
 */
function useDayEnds(stored: StoredToday | null, readAgain: () => void, dropAndReadAgain: () => void): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === TODAY_WIPE_KEY) dropAndReadAgain();
    };
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) dropAndReadAgain();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [dropAndReadAgain]);
  useEffect(() => {
    if (!stored) return;
    const remaining = Date.parse(stored.snapshot.validUntil) - Date.now();
    const timer = window.setTimeout(readAgain, Math.min(Math.max(remaining, 0), MAX_TIMER_MS));
    return () => window.clearTimeout(timer);
  }, [stored, readAgain]);
}

/**
 * The device's day for the address the person opened. Without a stored day
 * (never refreshed, another day, or wiped), and while the device reads, it
 * shows `withoutDay`, the plain no-signal page.
 */
export function OfflineToday({ withoutDay }: { withoutDay: ReactNode }): ReactNode {
  // Each wipe signal starts a fresh read and drops the shown day with it (useClientRead's deps).
  const [wipes, setWipes] = useState(0);
  const dropAndReadAgain = useCallback(() => setWipes((count) => count + 1), []);
  const day = useClientRead({
    read: async () => {
      const signal = wipeSignal();
      try {
        const stored = await readTodayOnDevice();
        // A wipe signalled while the device read: its answer is the former day, never shown.
        const current = signal !== null && wipeSignal() === signal;
        return {
          success: true as const,
          stored: current ? stored : null,
          pathname: window.location.pathname,
        };
      } catch (error) {
        logError('OfflineToday: device storage failed', error);
        return { success: false as const, error: 'load_failed' };
      }
    },
    deps: [wipes],
    failureMessage: 'Der Speicher deines Geräts hat nicht geantwortet.',
  });
  useDayEnds(day.data?.stored ?? null, day.reload, dropAndReadAgain);

  if (day.failure)
    return (
      <div className="w-full max-w-2xl">
        <SectionError title="Deine Einsätze von heute konnten nicht gelesen werden" failure={day.failure} />
      </div>
    );
  // The device answers within a frame; until then the plain no-signal page stands, never a skeleton that
  // most phones, which keep no day, would replace with exactly that page.
  if (!day.data?.stored) return withoutDay;
  return <OfflineDayView stored={day.data.stored} pathname={day.data.pathname} />;
}
