'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { MailFields, mailErrors, sendBanner } from '@/components/delivery/mail-fields';
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
import { Input } from '@/components/ui/input';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { DELIVERY_LIMITS, type DeliveryMailDefaults } from '@/lib/delivery/delivery-types';
import { markInvoiceSentManually, sendInvoiceEmail } from '@/lib/invoices/delivery-actions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { DELIVERY_FAILURE_MESSAGES } from './invoice-delivery-messages';

const SEND_FAILED = 'Die E-Mail konnte nicht versendet werden. Bitte versuche es erneut.';
const RECORD_FAILED = 'Der Versand konnte nicht vermerkt werden. Bitte versuche es erneut.';

/**
 * „Per E-Mail senden“: the invoice's filed original to one recipient, with
 * subject and text the office can change. One press sends once: a repeated
 * press of the same form answers the first send; a changed form is a new one.
 */
export function SendInvoiceEmailDialog({
  invoiceId,
  invoiceNumber,
  defaults,
  sentBefore,
  onClose,
}: {
  invoiceId: string;
  invoiceNumber: string;
  defaults: DeliveryMailDefaults;
  /** The last email that went out or may have, shown so the office does not send twice by mistake. */
  sentBefore: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { run, isPending } = useServerAction(sendInvoiceEmail);
  const [form, setForm] = useState(defaults);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = attempted ? mailErrors(form) : {};
  const change = (patch: Partial<DeliveryMailDefaults>) => {
    setForm({ ...form, ...patch });
    setAttemptKey(crypto.randomUUID());
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(mailErrors(form))) return;
    setError(null);
    const result = await run({ invoiceId, attemptKey, ...form }).catch(() => null);
    if (!result) return setError(SEND_FAILED);
    if (!result.success)
      return setError(describeFailure(result.error, DELIVERY_FAILURE_MESSAGES, SEND_FAILED));
    onClose();
    showBanner(sendBanner(result, `Rechnung ${invoiceNumber}`, form.recipient.trim()));
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isPending}>
      <DialogContent>
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Rechnung per E-Mail senden</DialogTitle>
            <DialogDescription>
              Die Rechnung {invoiceNumber} hängt als PDF an, genau wie sie abgelegt ist.
              {sentBefore ? ` ${sentBefore}` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <MailFields form={form} errors={errors} change={change} />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending} disabled={isPending}>
              Senden
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** „Als manuell versendet markieren“: the office sent the invoice itself; WerkFlow sends nothing. */
export function ManualDeliveryDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { run, isPending } = useServerAction(markInvoiceSentManually);
  const [note, setNote] = useState('');
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const result = await run({ invoiceId, attemptKey, note }).catch(() => null);
    if (!result) return setError(RECORD_FAILED);
    if (!result.success)
      return setError(describeFailure(result.error, DELIVERY_FAILURE_MESSAGES, RECORD_FAILED));
    onClose();
    showBanner({ variant: 'success', message: 'Die Rechnung ist als manuell versendet vermerkt.' });
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={isPending}>
      <DialogContent size="md">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Als manuell versendet markieren</DialogTitle>
            <DialogDescription>
              Für eine Rechnung, die per Post oder persönlich rausging. WerkFlow verschickt dabei nichts.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2 py-1">
            <Field label="Notiz" htmlFor="delivery-note" description="Zum Beispiel „per Post am 21.11.“">
              <Input
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setAttemptKey(crypto.randomUUID());
                }}
                maxLength={DELIVERY_LIMITS.note}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending} disabled={isPending}>
              Als versendet markieren
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
