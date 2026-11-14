'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { createOffer } from '@/lib/offers/actions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import {
  OFFER_FAILURE_MESSAGES,
  OfferCustomerFields,
  offerCustomerErrors,
  type OfferCustomerForm,
} from './offer-customer-fields';

const SAVE_FAILED = OFFER_FAILURE_MESSAGES.save_failed ?? '';

/**
 * „Angebot anlegen“: title and customer, optionally Einsatzort and
 * Ansprechpartner. The new offer opens on its own page, where the rest of its
 * header can be edited. A press repeated after a lost answer sends the same
 * key and opens the first offer.
 */
export function CreateOfferDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<OfferCustomerForm>({ title: '', client: null, siteId: '', contactId: '' });
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending: pending } = usePendingTask();
  const errors = offerCustomerErrors(form);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(errors) || !form.client) return;
    const clientId = form.client.id;
    void run(async () => {
      setError(null);
      const result = await createOffer({
        attemptKey,
        title: form.title,
        clientId,
        siteId: form.siteId || null,
        contactId: form.contactId || null,
      }).catch(() => null);
      if (!result?.success) {
        setError(result ? describeFailure(result.error, OFFER_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
        return;
      }
      router.push(`/angebote/${result.offerId}`);
      return untilPageLeaves();
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={pending}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Angebot anlegen</DialogTitle>
            <DialogDescription>
              Rechnungsempfänger, Gültigkeit und Texte übernimmt das Angebot aus Einsatzort und Firmenprofil.
              Du kannst sie danach ändern.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <OfferCustomerFields
              form={form}
              onChange={setForm}
              errors={attempted ? errors : {}}
              disabled={pending}
            />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={pending}>
              Angebot anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
