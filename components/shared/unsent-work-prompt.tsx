'use client';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import '@/lib/field-sync/device/registrations';
import { discardUnsentWork, flushUnsentWork, type UnsentWorkItem } from '@/lib/field-sync/device/unsent-work';
import { logError } from '@/lib/logging';

// The question a sign-out or an organization switch asks about unsent work
// (components/shared/unsent-work-gate.ts loads it). It renders in a root of
// its own: the six flows that ask sit in different trees, some outside the
// app shell, and none of them carries this dialog's code at start.

function itemsLabel(items: readonly UnsentWorkItem[]): string {
  return items.map((item) => `${item.count} ${item.label}`).join(', ');
}

/** The irreversible step behind „Verwerfen“: it names what goes and asks once more. */
function DiscardConfirmation({
  items,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  items: readonly UnsentWorkItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={pending}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nicht Übertragenes verwerfen?</AlertDialogTitle>
          <AlertDialogDescription>
            {itemsLabel(items)}: Das wird von diesem Gerät gelöscht und nie erfasst.
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

function UnsentItems({ items }: { items: readonly UnsentWorkItem[] }) {
  return (
    <ul className="divide-y rounded-md border text-sm" aria-label="Nicht übertragen">
      {items.map((item) => (
        <li key={item.label} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="font-medium">{item.label}</span>
          <span className="text-muted-foreground tabular-nums">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Carries out „Jetzt senden“ and „Verwerfen“, one at a time, and keeps what is still unsent. */
function useUnsentChoice(initialItems: UnsentWorkItem[], onSettled: (mayEnd: boolean) => void) {
  const { run, isPending } = usePendingTask();
  const [items, setItems] = useState(initialItems);
  const [running, setRunning] = useState<'send' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function perform(action: 'send' | 'discard'): void {
    setError(null);
    setRunning(action);
    void run(async () => {
      try {
        if (action === 'discard') {
          await discardUnsentWork();
          onSettled(true);
          return;
        }
        const left = await flushUnsentWork();
        if (left.length === 0) {
          onSettled(true);
          return;
        }
        setItems(left);
        setError('Noch nicht alles ist übertragen. Prüfe dein Netz und versuche es erneut.');
      } catch (failure) {
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
  onSettled,
}: {
  initialItems: UnsentWorkItem[];
  /** True: nothing is unsent any more, the session may end. False: the person stays. */
  onSettled: (mayEnd: boolean) => void;
}) {
  const { items, isSending, isDiscarding, isPending, error, perform } = useUnsentChoice(
    initialItems,
    onSettled,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onSettled(false)} pending={isPending}>
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
          <UnsentItems items={items} />
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onSettled(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="destructive"
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
          onConfirm={() => perform('discard')}
          pending={isDiscarding}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Shows the dialog and resolves with the person's choice once it is carried out. */
function askAboutUnsentWork(items: UnsentWorkItem[]): Promise<boolean> {
  return new Promise((resolve) => {
    // The root is gone before the dialog could hand the focus back, so this does it.
    const opener = document.activeElement;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      <UnsentWorkDialog
        initialItems={items}
        onSettled={(mayEnd) => {
          root.unmount();
          host.remove();
          if (!mayEnd && opener instanceof HTMLElement && opener.isConnected) opener.focus();
          resolve(mayEnd);
        }}
      />,
    );
  });
}

/**
 * Sends what the device holds unsent for the signed-in person. With something left, the person
 * decides: true once nothing is unsent or it was discarded, false when the person stays. Throws
 * when the device storage cannot say what is left: the session must not end then.
 */
export async function settleUnsentWork(): Promise<boolean> {
  const left = await flushUnsentWork();
  return left.length === 0 || askAboutUnsentWork(left);
}
