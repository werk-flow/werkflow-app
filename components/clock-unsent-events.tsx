'use client';

import { useState, type ComponentProps } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import { lazyDialog } from '@/components/shared/lazy-dialog';
import {
  UnsentEventList,
  UnsentStatusBadge,
  unsentChainReason,
  unsentChainStatus,
} from '@/components/clock-unsent-list';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import { clockHolder } from '@/lib/field-sync/device/clock-device';
import {
  deleteUnsentTimeEvents,
  resendRefusedTimeEvent,
  sendUnsentNow,
} from '@/lib/field-sync/device/clock-outbox';
import {
  chainSessionRuns,
  correctionOffered,
  correctionScope,
  type ClockDeviceView,
} from '@/lib/field-sync/device/time-outbox';
import { logError } from '@/lib/logging';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { formatBerlinTime, parseIsoLocalDate } from '@/lib/utils';

// The one lazy entry of the clock's outbox: the call that attaches a page to it, and the view below.
export { attachClockOutbox } from '@/lib/field-sync/device/clock-outbox';

// The clock's view of the events this phone holds unsent (decision record
// 0010, the 2026-11-11 amendment "the time outbox"). The clock dock and its
// sheet load this file only while such events exist.

/**
 * The existing correction request, loaded when the person asks for it: its form is far larger than
 * this view. A load that fails without signal closes it with an error banner; the next tap retries.
 */
const CorrectionDialog = lazyDialog(() =>
  import('@/components/manual-entry-dialog').then(({ ManualEntryDialog }) => {
    function ClockCorrectionDialog({
      open,
      onOpenChange,
      ...props
    }: Omit<ComponentProps<typeof ManualEntryDialog>, 'controlledOpen' | 'onOpenChange'> & {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) {
      return <ManualEntryDialog {...props} controlledOpen={open} onOpenChange={onOpenChange} />;
    }
    return ClockCorrectionDialog;
  }),
);

const STORAGE_FAILED = 'Der Speicher deines Geräts hat nicht geantwortet. Bitte versuche es erneut.';

/** Runs one outbox action at a time and shows its failure under the buttons. */
function useOutboxAction() {
  const { run, isPending } = usePendingTask();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Answers whether the action succeeded; a failure stays shown at its action. */
  async function perform(id: string, task: () => Promise<void>): Promise<boolean> {
    setError(null);
    setRunning(id);
    let succeeded = false;
    await run(async () => {
      try {
        await task();
        succeeded = true;
      } catch (failure) {
        logError('clock outbox: action failed', failure);
        setError(STORAGE_FAILED);
      } finally {
        setRunning(null);
      }
    });
    return succeeded;
  }
  return { perform, running, isPending, error };
}

/**
 * The correction the first day's kept events prefill: their day, its first start and its last end. A
 * chain whose session still runs on the server offers no correction (correctionOffered, time-outbox.ts).
 */
function correctionPrefill(day: ClockDeviceView['events']) {
  const first = day[0];
  const end = day.findLast((event) => event.action === 'end');
  if (!first) return {};
  const date = formatBerlinLocalDate(first.capturedAt);
  return {
    preselectedDate: parseIsoLocalDate(date),
    ...(first.action === 'start' ? { preselectedClockInTime: formatBerlinTime(first.capturedAt) } : {}),
    ...(end ? { preselectedClockOutTime: formatBerlinTime(end.capturedAt) } : {}),
  };
}

/** Whether the filed request records the person's own time on the day of the kept session it replaces. */
function coversSession(
  filed: { userId: string; day: string },
  userId: string | undefined,
  session: ClockDeviceView['events'],
): boolean {
  const day = session[0] && formatBerlinLocalDate(session[0].capturedAt);
  return filed.userId === userId && filed.day === day;
}

/** The order that keeps the captured times and counts them once. */
function OpenSessionSteps({ timesWhere }: { timesWhere: string }) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground" data-clock-open-session>
      <p>Diese Zeiten gehören zu einer Zeiterfassung, die noch läuft. So gehst du vor:</p>
      <ol className="list-decimal space-y-0.5 pl-5">
        <li>Notiere dir die Zeiten {timesWhere}.</li>
        <li>Lösche sie hier.</li>
        <li>Beende die laufende Zeiterfassung über die Uhr.</li>
        <li>Beantrage dann eine Zeitkorrektur mit diesen Zeiten.</li>
      </ol>
    </div>
  );
}

function DeleteUnsentDialog({
  count,
  shown,
  open,
  onOpenChange,
  onConfirm,
  pending,
  error,
}: {
  count: number;
  /** The events to delete with their times, when they belong to a session that still runs. */
  shown: ClockDeviceView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Answers whether the events were deleted: only then does the question close. */
  onConfirm: () => Promise<boolean>;
  pending: boolean;
  error: string | null;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={pending}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nicht übertragene Zeiten löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1
              ? 'Die Stempelzeit wird von diesem Gerät gelöscht und nicht erfasst.'
              : `Die ${count} Stempelzeiten werden von diesem Gerät gelöscht und nicht erfasst.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {shown && (
          <div className="space-y-3">
            <UnsentEventList view={shown} />
            <OpenSessionSteps timesWhere="oben" />
          </div>
        )}
        <AlertDialogFooter error={error}>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            pending={pending}
            onClick={(event) => {
              // The dialog stays until the device answered, and stays open with the failure.
              event.preventDefault();
              void onConfirm().then((deleted) => deleted && onOpenChange(false));
            }}
          >
            Endgültig löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The person's choices for the chain: send it now while it waits, or settle it once it stopped. */
function UnsentActions({
  status,
  running,
  busy,
  onSend,
  onResend,
  canCorrect,
  onCorrect,
  onDelete,
}: {
  status: ReturnType<typeof unsentChainStatus>;
  /** False for an unreadable stop, or a chain whose session still runs: those are deleted, then corrected. */
  canCorrect: boolean;
  running: string | null;
  busy: boolean;
  onSend: () => void;
  onResend: () => void;
  onCorrect: () => void;
  onDelete: () => void;
}) {
  if (status === 'pending')
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        pending={running === 'send'}
        disabled={busy}
        onClick={onSend}
      >
        Jetzt senden
      </Button>
    );
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'failed' && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          pending={running === 'resend'}
          disabled={busy}
          onClick={onResend}
        >
          Erneut senden
        </Button>
      )}
      {canCorrect && (
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onCorrect}>
          Korrektur beantragen
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 text-destructive"
        disabled={busy}
        onClick={onDelete}
      >
        Löschen
      </Button>
    </div>
  );
}

/** The sheet's section: every unsent event, what happens to it, and the person's choices. */
function UnsentPanel({ view }: { view: ClockDeviceView }) {
  const { confirmed } = useClockState();
  const { perform, running, isPending, error } = useOutboxAction();
  // What each question saw when it opened: a deletion or a correction acts on exactly that, never on
  // events another tab settled or kept while it was open.
  const [deletion, setDeletion] = useState<ClockDeviceView['events'] | null>(null);
  const [correction, setCorrection] = useState<ClockDeviceView['events'] | null>(null);
  const status = unsentChainStatus(view);
  const holder = clockHolder();
  const openSession = status !== 'pending' && chainSessionRuns(view, confirmed);

  /** Deletes exactly `events`, the ones the person was shown; what stays goes on from the server's clock. */
  async function deleteEvents(events: ClockDeviceView['events']): Promise<boolean> {
    return perform('delete', async () => {
      if (holder)
        await deleteUnsentTimeEvents(
          holder,
          events.map((event) => event.operationId),
          confirmed,
        );
    });
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-3" aria-labelledby="clock-unsent-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="clock-unsent-heading" className="text-sm font-semibold">
          Noch nicht übertragen
        </h3>
        <UnsentStatusBadge view={view} />
      </div>
      <p className="text-sm text-muted-foreground">{unsentChainReason(view)}</p>
      {openSession && <OpenSessionSteps timesWhere="unten" />}
      <UnsentEventList view={view} />
      <UnsentActions
        status={status}
        running={running}
        busy={isPending}
        canCorrect={correctionOffered(view, confirmed)}
        onSend={() => void perform('send', sendUnsentNow)}
        onResend={() =>
          void perform('resend', async () => {
            if (holder) await resendRefusedTimeEvent(holder);
          })
        }
        // One correction request records one session on one day: the rest stays for its own.
        onCorrect={() => setCorrection(correctionScope(view))}
        onDelete={() => setDeletion(view.events)}
      />
      <ErrorText>{error}</ErrorText>
      <DeleteUnsentDialog
        count={deletion?.length ?? 0}
        shown={openSession && deletion ? { ...view, events: deletion } : null}
        open={deletion !== null}
        onOpenChange={(open) => !open && setDeletion(null)}
        onConfirm={() => deleteEvents(deletion ?? [])}
        pending={running === 'delete'}
        error={error}
      />
      <CorrectionDialog.Dialog
        open={correction !== null}
        onOpenChange={(open) => !open && setCorrection(null)}
        {...correctionPrefill(correction ?? [])}
        preselectedUserId={holder?.userId}
        // The request is filed, and the form confirms it: only now do the session's kept events leave the phone,
        // and only for a request of this person on that day; an Admin or Büro may file one for someone else.
        onSuccess={async (_entries, filed) => {
          if (correction && coversSession(filed, holder?.userId, correction)) await deleteEvents(correction);
        }}
      />
    </section>
  );
}

/**
 * The clock's unsent events: a badge in the dock, the full section in the sheet. Renders nothing
 * while the phone holds none for the signed-in person.
 */
export default function ClockUnsentEvents({ place }: { place: 'dock' | 'sheet' }) {
  const { unsent } = useClockState();
  if (!unsent) return null;
  return place === 'dock' ? <UnsentStatusBadge view={unsent} /> : <UnsentPanel view={unsent} />;
}
