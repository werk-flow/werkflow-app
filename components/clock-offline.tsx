'use client';

import { useCallback, useEffect, useState } from 'react';

import { ClockActionButtons } from '@/components/clock-action-buttons';
import { UnsentEventList, UnsentStatusBadge, unsentChainReason } from '@/components/clock-unsent-list';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { useClientRead } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { outboxChanged, takeInKept } from '@/lib/field-sync/device/clock-device';
import { captureTimeEvent, clockDeviceView, type ClockDeviceView } from '@/lib/field-sync/device/time-outbox';
import { readWholeTimeOutbox, type OutboxHolder } from '@/lib/field-sync/device/time-outbox-store';
import { sharedWipeGeneration } from '@/lib/field-sync/device/today-store';
import { TODAY_WIPE_KEY } from '@/lib/field-sync/device/today-wipe';
import { logError } from '@/lib/logging';
import { deriveClockActions, describeActivity, type ClockAction } from '@/lib/time-tracking/clock-actions';
import { formatBerlinTime } from '@/lib/utils';

// The clock on the page a phone shows without signal (app/offline/page.tsx).
// That page knows no session, so it reads the device alone and fails closed:
// it shows the clock of the one person whose unsent events were kept since
// the latest wipe signal, and nothing after a sign-out, an organization
// switch or a visit to a login page. It only captures; the app sends, once it
// loads with signal and knows who is signed in.

type OfflineClock = { holder: OutboxHolder; view: ClockDeviceView; generation: string };

/** The one clock kept under the current wipe signal, or null: none, several, or a signal that cannot be read. */
async function readOfflineClock(): Promise<OfflineClock | null> {
  const generation = sharedWipeGeneration();
  if (generation === null) return null;
  // What the app's page kept when its signal went is in no outbox yet; each action goes to its own person's.
  await takeInKept();
  const { clocks, events } = await readWholeTimeOutbox();
  const current = clocks.filter((clock) => clock.wipeGeneration === generation);
  const [clock] = current;
  if (!clock || current.length !== 1) return null;
  const holder = { userId: clock.userId, organizationId: clock.organizationId };
  const view = clockDeviceView(
    {
      clock,
      events: events.filter(
        (event) => event.userId === holder.userId && event.organizationId === holder.organizationId,
      ),
    },
    new Date(),
  );
  // A wipe signalled while the device read: its answer is the former person's clock, never shown.
  return view && sharedWipeGeneration() === generation ? { holder, view, generation } : null;
}

/** Reads the device's clock, and again when another tab's sign-out or switch wipes, or the page returns from the back-forward cache. */
function useOfflineClock() {
  const [reads, setReads] = useState(0);
  const readAgain = useCallback(() => setReads((count) => count + 1), []);
  const clock = useClientRead({
    read: async () => {
      try {
        return { success: true as const, clock: await readOfflineClock() };
      } catch (error) {
        logError('OfflineClock: device storage failed', error);
        return { success: false as const, error: 'load_failed' };
      }
    },
    deps: [reads],
    failureMessage: 'Der Speicher deines Geräts hat nicht geantwortet.',
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === TODAY_WIPE_KEY || event.key === null) readAgain();
    };
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) readAgain();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [readAgain]);
  return { clock: clock.data?.clock ?? null, failure: clock.failure, reload: clock.reload };
}

/** The actions a phone can capture alone: a job choice or a rarer activity needs the app's lists. */
function offlineActions(view: ClockDeviceView): ClockAction[] {
  return view.state
    ? deriveClockActions(view.state).filter((action) => action.kind === 'transition' || action.kind === 'end')
    : [];
}

/** The clock without signal: where it stands with the unsent events, and the next actions it can capture. */
export function OfflineClock() {
  const { clock, failure, reload } = useOfflineClock();
  const { run, isPending } = usePendingTask();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (failure)
    return (
      <div className="mb-6 w-full max-w-2xl">
        <SectionError title="Deine Zeiterfassung konnte nicht gelesen werden" failure={failure} />
      </div>
    );
  if (!clock) return null;
  const { holder, view, generation } = clock;
  const { state } = view;

  function activate(action: ClockAction): void {
    if (action.kind !== 'transition' && action.kind !== 'end') return;
    setError(null);
    setPendingId(action.id);
    void run(async () => {
      try {
        await captureTimeEvent(holder, {
          command: {
            operationId: crypto.randomUUID(),
            action: action.kind === 'end' ? 'end' : state?.isClockedIn ? 'switch' : 'start',
            expectedSessionId: null,
            expectedVersion: null,
            selection: action.kind === 'end' ? null : action.selection,
          },
          // Every event here stands on the one before it; the page holds no confirmed clock of its own.
          base: null,
          capturedAt: new Date(),
          triedOnline: false,
          wipeGeneration: generation,
        });
        await outboxChanged();
      } catch (failure) {
        logError('OfflineClock: clock action not kept on the device', failure);
        setError('Dein Gerät konnte die Zeit nicht speichern. Bitte versuche es erneut.');
      } finally {
        setPendingId(null);
        reload();
      }
    });
  }

  return (
    <section
      className="mb-6 w-full max-w-2xl space-y-3 rounded-lg border bg-card p-4 text-left shadow-xs"
      aria-labelledby="offline-clock-heading"
      data-testid="offline-clock"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="offline-clock-heading" className="text-base font-semibold">
          Zeiterfassung
        </h2>
        <UnsentStatusBadge view={view} />
      </div>
      {state && (
        <p className="text-sm font-medium" data-clock-status="">
          {state.isClockedIn && state.currentActivity && state.statusStartedAt
            ? `${describeActivity(state.currentActivity, state.activeJobInfo)} · seit ${formatBerlinTime(state.statusStartedAt)} Uhr`
            : 'Nicht eingestempelt'}
        </p>
      )}
      <ClockActionButtons
        actions={offlineActions(view)}
        busy={isPending}
        pendingId={pendingId}
        onActivate={activate}
      />
      <ErrorText>{error}</ErrorText>
      <p className="text-sm text-muted-foreground">
        {state
          ? 'Deine Zeiten sind auf diesem Gerät gespeichert. Öffne WerkFlow, sobald du wieder Netz hast, dann werden sie gesendet.'
          : `${unsentChainReason(view)} Öffne WerkFlow mit Netz, um das zu klären.`}
      </p>
      <UnsentEventList view={view} />
    </section>
  );
}
