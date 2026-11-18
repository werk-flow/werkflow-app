'use client';

import { Ban, FilePenLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
import { Textarea } from '@/components/ui/textarea';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { cancelInvoice } from '@/lib/invoices/cancel-actions';
import { CANCELLATION_REASON_MAX_LENGTH } from '@/lib/invoices/cancel-model';
import type { IssueFinding } from '@/lib/invoices/issue-model';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { IssueFindings } from './invoice-issue';
import { INVOICE_FAILURE_MESSAGES } from './invoice-failure-messages';

const CANCEL_FAILED = INVOICE_FAILURE_MESSAGES.cancel_failed ?? '';
const REASON_FIELD_ID = 'invoice-cancel-reason';

const MODES = {
  cancel: {
    trigger: 'Stornieren',
    icon: Ban,
    title: (number: string) => `Rechnung ${number} stornieren?`,
    description:
      'Eine Stornorechnung mit der nächsten Rechnungsnummer hebt alle Beträge auf. Die Rechnung selbst bleibt unverändert erhalten und gilt danach als storniert. Das lässt sich nicht rückgängig machen.',
    submit: 'Stornorechnung ausstellen',
  },
  correct: {
    trigger: 'Korrigieren',
    icon: FilePenLine,
    title: (number: string) => `Rechnung ${number} korrigieren?`,
    description:
      'Eine ausgestellte Rechnung lässt sich nicht ändern. Sie wird mit einer Stornorechnung storniert, und du erhältst einen neuen Entwurf mit ihren Positionen, den du anpasst und neu ausstellst. Die Rechnung selbst bleibt unverändert erhalten.',
    submit: 'Stornieren und Entwurf anlegen',
  },
} as const;

/**
 * „Stornieren“ or „Korrigieren“ an issued invoice: the reason is required and
 * printed on the Stornorechnung. Korrigieren opens the new draft.
 */
export function CancelInvoiceButton({
  invoice,
  mode,
}: {
  invoice: { id: string; invoiceNumber: string };
  mode: keyof typeof MODES;
}) {
  const [open, setOpen] = useState(false);
  const copy = MODES[mode];
  const Icon = copy.icon;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Icon className="size-4" />
        {copy.trigger}
      </Button>
      {open && <CancelInvoiceDialog invoice={invoice} mode={mode} onClose={() => setOpen(false)} />}
    </>
  );
}

type CancelDialogProps = {
  invoice: { id: string; invoiceNumber: string };
  mode: keyof typeof MODES;
  onClose: () => void;
};

/** The reason, its error after a first press, and the cancel with its banner and next page. */
function useCancelInvoice({ invoice, mode, onClose }: CancelDialogProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  // The dialog mounts per opening, so one key per opening: a retried press answers with the first Storno.
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<IssueFinding[]>([]);
  const { run, isPending } = usePendingTask();
  const reasonError = reason.trim() ? undefined : 'Gib den Grund der Stornierung an.';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setAttempted(true);
    if (focusFirstInvalidField({ [REASON_FIELD_ID]: reasonError })) return;
    setError(null);
    setFindings([]);
    void run(async () => {
      const result = await cancelInvoice({
        invoiceId: invoice.id,
        attemptKey,
        reason: reason.trim(),
        correct: mode === 'correct',
      }).catch(() => null);
      if (!result) {
        setError(CANCEL_FAILED);
        return;
      }
      if (!result.success) {
        if ('findings' in result) setFindings(result.findings);
        else setError(describeFailure(result.error, INVOICE_FAILURE_MESSAGES, CANCEL_FAILED));
        return;
      }
      const filed = result.originalFiled
        ? 'ausgestellt und abgelegt'
        : 'ausgestellt, ihr Beleg ist noch nicht abgelegt';
      showBanner({
        variant: result.originalFiled ? 'success' : 'info',
        message: `Rechnung ${invoice.invoiceNumber} ist storniert. Stornorechnung ${result.stornoNumber} ist ${filed}.`,
      });
      if (result.correctionId) {
        router.push(`/rechnungen/${result.correctionId}`);
        return untilPageLeaves();
      }
      onClose();
      router.refresh();
    });
  };
  return {
    reason,
    setReason,
    reasonError: attempted ? reasonError : undefined,
    error,
    findings,
    isPending,
    submit,
  };
}

function CancelInvoiceDialog(props: CancelDialogProps) {
  const { invoice, mode, onClose } = props;
  const copy = MODES[mode];
  const { reason, setReason, reasonError, error, findings, isPending, submit } = useCancelInvoice(props);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      pending={isPending}
    >
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{copy.title(invoice.invoiceNumber)}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3 py-1">
            <Field
              label="Grund der Stornierung"
              htmlFor={REASON_FIELD_ID}
              required
              description="Steht auf der Stornorechnung."
              error={reasonError}
            >
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={CANCELLATION_REASON_MAX_LENGTH}
                placeholder="z. B. falsche Menge abgerechnet"
                required
              />
            </Field>
            <IssueFindings
              findings={findings}
              title="Die Stornorechnung besteht die Prüfung nicht; nichts wurde storniert. Ergänze:"
            />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
