'use client';

import { useState } from 'react';

import {
  ClientSelectWithCreate,
  type ClientSelectItem,
} from '@/components/auftraege/shared/client-select-with-create';
import { useBanner } from '@/components/ui/banner';
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
import { SectionError } from '@/components/ui/section-error';
import { Field } from '@/components/ui/field';
import { usePendingTask, useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { setWorkBillingParties } from '@/lib/billing-parties/actions';
import type { BillingWorkKind } from '@/lib/billing-parties/types';
import type { ResolvedBillingVersion } from '@/lib/billing-parties/resolve';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const ERROR_MESSAGES: Record<string, string> = {
  work_not_found: 'Die Arbeit wurde nicht gefunden.',
  request_not_editable: 'Die Anfrage ist abgeschlossen und lässt sich nicht mehr ändern.',
  client_required: 'Ordne zuerst einen Kunden zu.',
  client_not_found: 'Der Auftraggeber wurde nicht gefunden.',
  recipient_not_found: 'Der Rechnungsempfänger wurde nicht gefunden.',
  client_archived: 'Der Kunde ist archiviert. Stelle ihn zuerst wieder her.',
};

/** A save refused because another save landed first reads the parties again. */
const REREAD_ON = new Set(['parties_changed']);

const REREAD_PENDING =
  'Auftraggeber oder Rechnungsempfänger wurden gerade geändert. Die aktuellen Angaben werden geladen…';
const REREAD_LANDED =
  'Auftraggeber oder Rechnungsempfänger wurden gerade geändert. Hier stehen jetzt die aktuellen Angaben; prüfe sie und speichere erneut.';
const REREAD_FAILED =
  'Auftraggeber oder Rechnungsempfänger wurden gerade geändert, aber die aktuellen Angaben konnten nicht geladen werden. Deine Auswahl bleibt erhalten.';

const CLIENT_FIELD_ID = 'billing-parties-client';
const RECIPIENT_FIELD_ID = 'billing-parties-recipient';

/** The two customers the dialog edits, prefilled with the current version. */
type FormProps = {
  kind: BillingWorkKind;
  workId: string;
  current: ResolvedBillingVersion | null;
  /** The dialog's save task: the dialog stays open while a save runs. */
  task: ReturnType<typeof usePendingTask>;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** Reads the parties again through the live view, without closing the dialog. */
  onReread: () => Promise<void>;
  /** The live view's last read failed, so the shown parties may be outdated. */
  stale: boolean;
};

/** Where the reread after a refused save stands: none yet, running, or done. */
type RereadPhase = 'none' | 'reading' | 'done';

/**
 * The reread after a refused save, and its retry when it failed. The live view
 * owns the read and its failure: once the reread is done, a stale view means it
 * failed, a current one that it landed. The entered values stay until a
 * reread lands and the form takes the newer pair.
 */
function useRereadAfterRefusal(onReread: () => Promise<void>, stale: boolean) {
  const [phase, setPhase] = useState<RereadPhase>('none');
  const retry = useServerAction(async () => onReread());
  const done = phase === 'done';
  return {
    reading: phase === 'reading',
    failed: done && stale,
    landed: done && !stale,
    retry,
    /** A new save starts without the previous refusal's outcome. */
    reset: () => setPhase('none'),
    afterRefusal: async (): Promise<void> => {
      setPhase('reading');
      await onReread();
      setPhase('done');
    },
  };
}

/**
 * The save's outcome under the pickers: the reread's state after a refusal,
 * which says the pair is current only once the reread landed, else the error.
 */
function SaveOutcome({
  reread,
  error,
}: {
  reread: ReturnType<typeof useRereadAfterRefusal>;
  error: string | null;
}) {
  if (reread.failed)
    return (
      <SectionError onRetry={() => void reread.retry.run()} retryPending={reread.retry.isPending}>
        {REREAD_FAILED}
      </SectionError>
    );
  if (reread.reading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {REREAD_PENDING}
      </p>
    );
  return <ErrorText>{reread.landed ? REREAD_LANDED : error}</ErrorText>;
}

function useBillingPartiesForm({ kind, workId, current, task, onSaved, onReread, stale }: FormProps) {
  const { showBanner } = useBanner();
  const [client, setClient] = useState<ClientSelectItem | null>(current ? current.auftraggeber : null);
  const [recipient, setRecipient] = useState<ClientSelectItem | null>(current ? current.recipient : null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reread = useRereadAfterRefusal(onReread, stale);
  // The choice belongs to the version the form saw. A newer version replaces
  // it only after a save was refused for it, with the notice saying why; a
  // read that lands while the user edits never replaces the edit silently,
  // and a save from it is refused instead (adopted during render).
  const shownVersion = current?.version ?? 0;
  const [formVersion, setFormVersion] = useState(shownVersion);
  const [adoptNewer, setAdoptNewer] = useState(false);
  if (adoptNewer && formVersion !== shownVersion) {
    setAdoptNewer(false);
    setFormVersion(shownVersion);
    setClient(current ? current.auftraggeber : null);
    setRecipient(current ? current.recipient : null);
    setClientError(null);
    setRecipientError(null);
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    reread.reset();
    const nextClientError = client ? undefined : 'Bitte wähle den Auftraggeber.';
    const nextRecipientError = recipient ? undefined : 'Bitte wähle den Rechnungsempfänger.';
    setClientError(nextClientError ?? null);
    setRecipientError(nextRecipientError ?? null);
    if (
      focusFirstInvalidField({ [CLIENT_FIELD_ID]: nextClientError, [RECIPIENT_FIELD_ID]: nextRecipientError })
    )
      return;
    await task.run(async () => {
      const result = await setWorkBillingParties({
        kind,
        workId,
        clientId: client?.id ?? '',
        recipientClientId: recipient?.id ?? '',
        expectedVersion: formVersion,
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (!result.success && REREAD_ON.has(result.error)) {
        setAdoptNewer(true);
        await reread.afterRefusal();
        return;
      }
      if (!result.success) {
        setError(
          describeFailure(
            result.error,
            ERROR_MESSAGES,
            'Speichern fehlgeschlagen. Bitte versuche es erneut.',
          ),
        );
        return;
      }
      await onSaved();
      showBanner({ variant: 'success', message: 'Auftraggeber und Rechnungsempfänger gespeichert.' });
    });
  };

  return {
    reread,
    client,
    recipient,
    clientError,
    recipientError,
    error,
    submit,
    chooseClient: (next: ClientSelectItem | null) => {
      setClient(next);
      setClientError(null);
    },
    chooseRecipient: (next: ClientSelectItem | null) => {
      setRecipient(next);
      setRecipientError(null);
    },
  };
}

export type WorkBillingPartiesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: BillingWorkKind;
  workId: string;
  current: ResolvedBillingVersion | null;
  /** Resolves once the card shows the saved parties. */
  onSaved: () => Promise<void>;
  /** Reads the parties again after a refused save, through the live view. */
  onReread: () => Promise<void>;
  /** The live view's last read failed. */
  stale: boolean;
};

/**
 * Chooses who commissioned the work and who receives its invoice. Saving
 * copies the recipient's name and address onto the work; the previous choice
 * stays in its history.
 */
export function WorkBillingPartiesDialog({
  open,
  onOpenChange,
  kind,
  workId,
  current,
  onSaved,
  onReread,
  stale,
}: WorkBillingPartiesDialogProps) {
  const task = usePendingTask();
  const onClose = () => onOpenChange(false);
  return (
    <Dialog open={open} pending={task.isPending} onOpenChange={onOpenChange}>
      {open && (
        <WorkBillingPartiesForm
          kind={kind}
          workId={workId}
          current={current}
          task={task}
          onClose={onClose}
          onReread={onReread}
          stale={stale}
          onSaved={async () => {
            await onSaved();
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}

function WorkBillingPartiesForm(props: FormProps) {
  const { onClose } = props;
  const form = useBillingPartiesForm(props);
  // A running retry may replace the pair, so the pickers wait for it too.
  const isPending = props.task.isPending || form.reread.retry.isPending;
  return (
    <DialogContent size="md">
      <form onSubmit={form.submit} noValidate>
        <DialogHeader>
          <DialogTitle>Auftraggeber und Rechnungsempfänger</DialogTitle>
          <DialogDescription>
            Name und Anschrift des Rechnungsempfängers werden beim Speichern übernommen. Spätere Änderungen am
            Kunden ändern sie hier nicht.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 py-1">
          <Field label="Auftraggeber" htmlFor={CLIENT_FIELD_ID} required error={form.clientError}>
            <ClientSelectWithCreate
              id={CLIENT_FIELD_ID}
              value={form.client?.id ?? ''}
              selectedClient={form.client}
              onValueChange={(_value, next) => form.chooseClient(next)}
              disabled={isPending}
            />
          </Field>
          <Field
            label="Rechnungsempfänger"
            htmlFor={RECIPIENT_FIELD_ID}
            required
            error={form.recipientError}
            description="Zum Beispiel die Hausverwaltung, wenn sie die Rechnung bekommt."
          >
            <ClientSelectWithCreate
              id={RECIPIENT_FIELD_ID}
              value={form.recipient?.id ?? ''}
              selectedClient={form.recipient}
              onValueChange={(_value, next) => form.chooseRecipient(next)}
              disabled={isPending}
            />
          </Field>
          <SaveOutcome reread={form.reread} error={form.error} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Abbrechen
          </Button>
          <Button type="submit" pending={isPending}>
            Speichern
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
