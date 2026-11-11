'use client';

import { useState } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import {
  UnsentEventList,
  UnsentStatusBadge,
  unsentChainReason,
  unsentChainStatus,
} from '@/components/clock-unsent-list';
import { ManualEntryDialog } from '@/components/manual-entry-dialog';
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
import type { ClockDeviceView } from '@/lib/field-sync/device/time-outbox';
import { logError } from '@/lib/logging';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { formatBerlinTime, parseIsoLocalDate } from '@/lib/utils';

// The clock's view of the events this phone holds unsent (decision record
// 0010, the 2026-11-11 amendment "the time outbox"). The clock dock and its
// sheet load this file only while such events exist.

const STORAGE_FAILED = 'Der Speicher deines Geräts hat nicht geantwortet. Bitte versuche es erneut.';

/** Runs one outbox action at a time and shows its failure under the buttons. */
function useOutboxAction() {
  const { run, isPending } = usePendingTask();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function perform(id: string, task: () => Promise<void>): Promise<void> {
    setError(null);
    setRunning(id);
    return run(async () => {
      try {
        await task();
      } catch (failure) {
        logError('clock outbox: action failed', failure);
        setError(STORAGE_FAILED);
      } finally {
        setRunning(null);
      }
    });
  }
  return { perform, running, isPending, error };
}

/** The correction the kept events prefill: their day, the first start and the last end. */
function correctionPrefill(view: ClockDeviceView) {
  const first = view.events[0];
  const end = view.events.findLast((event) => event.action === 'end');
  if (!first) return {};
  return {
    preselectedDate: parseIsoLocalDate(formatBerlinLocalDate(first.capturedAt)),
    ...(first.action === 'start' ? { preselectedClockInTime: formatBerlinTime(first.capturedAt) } : {}),
    ...(end ? { preselectedClockOutTime: formatBerlinTime(end.capturedAt) } : {}),
  };
}

function DeleteUnsentDialog({
  count,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  pending: boolean;
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
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            pending={pending}
            onClick={(event) => {
              // The dialog stays until the device answered: a failure must land in an open dialog.
              event.preventDefault();
              void onConfirm().then(() => onOpenChange(false));
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
  onCorrect,
  onDelete,
}: {
  status: ReturnType<typeof unsentChainStatus>;
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
      <Button type="button" className="min-h-11" disabled={busy} onClick={onCorrect}>
        Korrektur beantragen
      </Button>
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
  const { perform, running, isPending, error } = useOutboxAction();
  const [deleting, setDeleting] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const status = unsentChainStatus(view);
  const holder = clockHolder();

  async function deleteEvents(): Promise<void> {
    await perform('delete', async () => {
      if (holder) await deleteUnsentTimeEvents(holder);
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
      <UnsentEventList view={view} />
      <UnsentActions
        status={status}
        running={running}
        busy={isPending}
        onSend={() => void perform('send', sendUnsentNow)}
        onResend={() =>
          void perform('resend', async () => {
            if (holder) await resendRefusedTimeEvent(holder);
          })
        }
        onCorrect={() => setCorrecting(true)}
        onDelete={() => setDeleting(true)}
      />
      <ErrorText>{error}</ErrorText>
      <DeleteUnsentDialog
        count={view.events.length}
        open={deleting}
        onOpenChange={setDeleting}
        onConfirm={deleteEvents}
        pending={running === 'delete'}
      />
      <ManualEntryDialog
        controlledOpen={correcting}
        onOpenChange={setCorrecting}
        {...correctionPrefill(view)}
        // The request is filed, and the form confirms it: only now do the kept events leave the phone.
        onSuccess={deleteEvents}
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
