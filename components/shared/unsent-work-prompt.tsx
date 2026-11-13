'use client';

import { useEffect, useRef, useState } from 'react';

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
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { showInUnsentWorkHost } from '@/components/shared/unsent-work-host';
import { usePendingTask } from '@/hooks/use-server-action';
import '@/lib/field-sync/device/registrations';
import {
  UnsentWorkBusyError,
  discardUnsentWork,
  flushUnsentWork,
  summarizeUnsentWork,
  type UnsentScope,
  type UnsentWorkItem,
} from '@/lib/field-sync/device/unsent-work';
import { logError } from '@/lib/logging';

// The question a sign-out or an organization switch asks about unsent work
// (components/shared/unsent-work-gate.ts loads it). It renders in the host the
// root layout mounts (unsent-work-host.tsx): the six flows that ask sit in
// different trees, some outside the app shell, and none of them carries this
// dialog's code at start.

function itemsLabel(items: readonly UnsentWorkItem[]): string {
  return items.map((item) => `${item.label}: ${item.count}`).join(', ');
}

/** The irreversible step behind „Verwerfen“: it names what goes and asks once more. */
function DiscardConfirmation({
  items,
  open,
  onOpenChange,
  onConfirm,
  pending,
  error,
}: {
  items: readonly UnsentWorkItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
  /** A failed discard, shown at its action with the retry beside it. */
  error: string | null;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={pending}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nicht Übertragenes verwerfen?</AlertDialogTitle>
          <AlertDialogDescription>
            {itemsLabel(items)}. Das wird von diesem Gerät gelöscht und nie erfasst.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={error}>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            pending={pending}
            onClick={(event) => {
              // The dialog stays until the device answered: a failure must land in an open dialog.
              event.preventDefault();
              onConfirm();
            }}
          >
            Endgültig verwerfen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Each line with its number, and below it the pieces it names one by one, such as each report draft. */
function UnsentItems({ items }: { items: readonly UnsentWorkItem[] }) {
  return (
    <ul className="divide-y rounded-md border text-sm" aria-label="Nicht übertragen">
      {items.map((item) => (
        <li key={item.label} className="space-y-2 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{item.label}</span>
            <span className="text-muted-foreground tabular-nums">{item.count}</span>
          </div>
          {item.entries && item.entries.length > 0 && (
            <ul className="space-y-1.5" aria-label={item.label}>
              {item.entries.map((entry) => (
                <li key={entry.id} className="min-w-0">
                  <p className="break-words">{entry.name}</p>
                  <p className="text-xs text-muted-foreground">{entry.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Carries out „Jetzt senden“ and „Verwerfen“, one at a time, and keeps what is still unsent. */
function useUnsentChoice(
  initialItems: UnsentWorkItem[],
  onSettled: (mayEnd: boolean) => void,
  scope: UnsentScope,
) {
  const { run, isPending } = usePendingTask();
  const [items, setItems] = useState(initialItems);
  const [running, setRunning] = useState<'send' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** `onKeptSince` runs when a discard leaves work kept after the question, which is asked about anew. */
  function perform(action: 'send' | 'discard', onKeptSince?: () => void): void {
    setError(null);
    setRunning(action);
    void run(async () => {
      try {
        if (action === 'discard') {
          // Only what the person was shown goes; work kept since then is asked about anew.
          const kept = await discardUnsentWork(items, scope);
          if (kept.length === 0) {
            onSettled(true);
            return;
          }
          setItems(kept);
          onKeptSince?.();
          setError('Seit deiner Frage ist noch etwas dazugekommen. Entscheide auch darüber.');
          return;
        }
        const left = await flushUnsentWork(scope);
        if (left.length === 0) {
          onSettled(true);
          return;
        }
        setItems(left);
        setError('Noch nicht alles ist übertragen. Prüfe dein Netz und versuche es erneut.');
      } catch (failure) {
        if (failure instanceof UnsentWorkBusyError) {
          setError(
            'Gerade wird noch etwas übertragen. Nichts wurde gelöscht. Versuche es gleich noch einmal.',
          );
          return;
        }
        logError('unsent work: the choice failed', failure);
        setError('Der Speicher deines Geräts hat nicht geantwortet. Bitte versuche es erneut.');
      } finally {
        setRunning(null);
      }
    });
  }
  return {
    items,
    isSending: isPending && running === 'send',
    isDiscarding: isPending && running === 'discard',
    isPending,
    error,
    perform,
  };
}

/** Names what is still unsent and offers to send it, to discard it, or to stay. */
function UnsentWorkDialog({
  initialItems,
  scope,
  onSettled,
}: {
  initialItems: UnsentWorkItem[];
  scope: UnsentScope;
  /** True: nothing is unsent any more, the session may end. False: the person stays. */
  onSettled: (mayEnd: boolean) => void;
}) {
  const { items, isSending, isDiscarding, isPending, error, perform } = useUnsentChoice(
    initialItems,
    onSettled,
    scope,
  );
  const [confirming, setConfirming] = useState(false);
  // The question opens at once and sends from here, so a stalled send never hides „Abbrechen“.
  const sendOnOpen = useRef(perform);
  useEffect(() => sendOnOpen.current('send'), []);

  return (
    <Dialog open onOpenChange={(open) => !open && onSettled(false)} pending={isDiscarding}>
      <DialogContent size="sm">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            perform('send');
          }}
        >
          <DialogHeader>
            <DialogTitle>Noch nicht übertragen</DialogTitle>
            <DialogDescription>
              Auf diesem Gerät wartet noch etwas, das das Büro nicht erreicht hat. Sende es, bevor du
              weitermachst. Was du verwirfst, ist endgültig gelöscht.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <UnsentItems items={items} />
            {isSending && (
              <p role="status" className="text-sm text-muted-foreground">
                Es wird gesendet …
              </p>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDiscarding} onClick={() => onSettled(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={isPending}
              onClick={() => setConfirming(true)}
            >
              Verwerfen
            </Button>
            <Button type="submit" pending={isSending} disabled={isPending}>
              Jetzt senden
            </Button>
          </DialogFooter>
        </form>
        <DiscardConfirmation
          items={items}
          open={confirming}
          onOpenChange={setConfirming}
          onConfirm={() => perform('discard', () => setConfirming(false))}
          pending={isDiscarding}
          error={confirming ? error : null}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Shows the dialog and resolves with the person's choice once it is carried out. */
function askAboutUnsentWork(items: UnsentWorkItem[], scope: UnsentScope): Promise<boolean> {
  return new Promise((resolve) => {
    // The dialog is gone before it could hand the focus back, so this does it.
    const opener = document.activeElement;
    let settled = false;
    const remove = showInUnsentWorkHost(
      <UnsentWorkDialog
        initialItems={items}
        scope={scope}
        onSettled={(mayEnd) => {
          // A send still running after „Abbrechen“ answers into the void.
          if (settled) return;
          settled = true;
          remove();
          if (!mayEnd && opener instanceof HTMLElement && opener.isConnected) opener.focus();
          resolve(mayEnd);
        }}
      />,
    );
  });
}

/**
 * Sends what the device holds unsent in the scope. With something left, the person
 * decides: true once nothing is unsent or it was discarded, false when the person stays. Throws
 * when the device storage cannot say what is left: the session must not end then.
 */
export async function settleUnsentWork(scope: UnsentScope): Promise<boolean> {
  // From the device alone: a send that stalls must never keep the question from opening.
  const unsent = await summarizeUnsentWork(scope);
  return unsent.length === 0 || askAboutUnsentWork(unsent, scope);
}
