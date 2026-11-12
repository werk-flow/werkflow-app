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
import { Field } from '@/components/ui/field';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { setWorkBillingParties } from '@/lib/billing-parties/actions';
import type { BillingWorkKind, WorkBillingPartyVersion } from '@/lib/billing-parties/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const ERROR_MESSAGES: Record<string, string> = {
  work_not_found: 'Die Arbeit wurde nicht gefunden.',
  request_not_editable: 'Die Anfrage ist abgeschlossen und lässt sich nicht mehr ändern.',
  client_required: 'Ordne zuerst einen Kunden zu.',
  client_not_found: 'Der Auftraggeber wurde nicht gefunden.',
  recipient_not_found: 'Der Rechnungsempfänger wurde nicht gefunden.',
  client_archived: 'Der Kunde ist archiviert. Stelle ihn zuerst wieder her.',
};

const CLIENT_FIELD_ID = 'billing-parties-client';
const RECIPIENT_FIELD_ID = 'billing-parties-recipient';

/** The two customers the dialog edits, prefilled with the current version. */
type FormProps = {
  kind: BillingWorkKind;
  workId: string;
  current: WorkBillingPartyVersion | null;
  /** The dialog's save task: the dialog stays open while a save runs. */
  task: ReturnType<typeof usePendingTask>;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

function useBillingPartiesForm({ kind, workId, current, task, onSaved }: FormProps) {
  const { showBanner } = useBanner();
  const [client, setClient] = useState<ClientSelectItem | null>(
    current ? { id: current.clientId, name: current.clientName } : null,
  );
  const [recipient, setRecipient] = useState<ClientSelectItem | null>(
    current ? { id: current.recipientClientId, name: current.recipientName } : null,
  );
  const [clientError, setClientError] = useState<string | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
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
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
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

/**
 * Chooses who commissioned the work and who receives its invoice. Saving
 * copies the recipient's name and address onto the work; the previous choice
 * stays in its history.
 */
export function WorkBillingPartiesDialog({
  open,
  kind,
  workId,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: BillingWorkKind;
  workId: string;
  current: WorkBillingPartyVersion | null;
  onClose: () => void;
  /** Resolves once the card shows the saved parties. */
  onSaved: () => Promise<void>;
}) {
  const task = usePendingTask();
  return (
    <Dialog open={open} pending={task.isPending} onOpenChange={(next) => !next && onClose()}>
      {open && (
        <WorkBillingPartiesForm
          kind={kind}
          workId={workId}
          current={current}
          task={task}
          onClose={onClose}
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
  const isPending = props.task.isPending;
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
          <ErrorText>{form.error}</ErrorText>
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
