'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DELIVERY_LIMITS,
  recipientSchema,
  type DeliveryMailDefaults,
  type DeliveryState,
} from '@/lib/delivery/delivery-types';
import { deliveryFailureAdvice } from '@/lib/delivery/failure-advice';

// The email form of a filed document's send (lib/delivery/): recipient,
// subject and text, their checks, and the banner after the send.

export function mailErrors(form: DeliveryMailDefaults): Record<string, string | undefined> {
  return {
    'delivery-recipient': recipientSchema.safeParse(form.recipient.trim()).success
      ? undefined
      : 'Gib eine E-Mail-Adresse ein, zum Beispiel buchhaltung@kunde.de.',
    'delivery-subject': form.subject.trim() ? undefined : 'Gib einen Betreff ein.',
  };
}

/** The banner after a send of `document` („Rechnung RE-1“): sent, still sending, or refused by the provider. */
export function sendBanner(
  result: { state: DeliveryState; failureCode: string | null },
  document: string,
  recipient: string,
): { variant: 'success' | 'info' | 'error'; message: string } {
  const { state } = result;
  if (state === 'failed') {
    return {
      variant: 'error',
      message: deliveryFailureAdvice(result.failureCode, 'Unter „Versand“ kannst du sie erneut senden.'),
    };
  }
  return state === 'sent'
    ? { variant: 'success', message: `${document} ist an ${recipient} versendet.` }
    : { variant: 'info', message: `${document} wird versendet.` };
}

/** Recipient, subject and text of the email. */
export function MailFields({
  form,
  errors,
  change,
}: {
  form: DeliveryMailDefaults;
  errors: Record<string, string | undefined>;
  change: (patch: Partial<DeliveryMailDefaults>) => void;
}) {
  return (
    <>
      <Field label="Empfänger" htmlFor="delivery-recipient" required error={errors['delivery-recipient']}>
        <Input
          type="email"
          autoComplete="email"
          value={form.recipient}
          onChange={(event) => change({ recipient: event.target.value })}
          maxLength={254}
          required
        />
      </Field>
      <Field label="Betreff" htmlFor="delivery-subject" required error={errors['delivery-subject']}>
        <Input
          value={form.subject}
          onChange={(event) => change({ subject: event.target.value })}
          maxLength={DELIVERY_LIMITS.subject}
          required
        />
      </Field>
      <Field label="Nachricht" htmlFor="delivery-text">
        <Textarea
          value={form.text}
          onChange={(event) => change({ text: event.target.value })}
          maxLength={DELIVERY_LIMITS.text}
          rows={7}
        />
      </Field>
    </>
  );
}
