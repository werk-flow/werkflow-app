'use client';

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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHydrated } from '@/hooks/use-hydrated';
import { usePayloadAttemptKey } from '@/hooks/use-payload-attempt-key';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import type { OfferDetail } from '@/lib/offers/types';
import { convertOfferToWork } from '@/lib/orders/actions';
import type { OrderTarget } from '@/lib/orders/types';
import { ownWrites } from '@/lib/realtime/own-writes';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const CONVERSION_FAILED = 'Die Arbeit konnte nicht angelegt werden. Versuche es erneut.';
const CONVERSION_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  save_failed: CONVERSION_FAILED,
  offer_changed: 'Jemand hat das Angebot gerade geändert. Lade die Seite neu.',
  offer_converted: 'Aus dem Angebot ist schon Arbeit entstanden. Lade die Seite neu.',
  offer_not_accepted: 'Das Angebot ist nicht mehr angenommen. Lade die Seite neu.',
  offer_not_found: 'Das Angebot gibt es nicht mehr.',
  work_not_found: 'Die Arbeit, für die das Angebot geschrieben ist, gibt es nicht mehr.',
  client_archived: 'Der Kunde oder der Rechnungsempfänger ist archiviert. Hole ihn zuerst zurück.',
  client_not_found: 'Den Kunden des Angebots gibt es nicht mehr.',
  recipient_not_found: 'Den Rechnungsempfänger des Angebots gibt es nicht mehr.',
  client_required:
    'Die Arbeit, für die das Angebot geschrieben ist, hat keinen Kunden. Trage ihn dort zuerst ein.',
  site_not_found: 'Den Einsatzort des Angebots gibt es nicht mehr.',
  contact_not_found: 'Den Ansprechpartner des Angebots gibt es nicht mehr.',
};

const FIELD = { target: 'offer-conversion-target', title: 'offer-conversion-title' } as const;

type ConvertibleOffer = Pick<OfferDetail, 'id' | 'offerNumber' | 'title' | 'version' | 'work'>;

/** The choices of the offer: a new job, a new project, and the job or project it was written for. */
function targetOptions(offer: ConvertibleOffer): Array<{ value: OrderTarget; label: string }> {
  const own = offer.work && offer.work.kind !== 'request' ? offer.work : null;
  return [
    ...(own
      ? [
          {
            value: 'offer_work' as const,
            label: `${own.kind === 'job' ? 'Auftrag' : 'Projekt'} ${own.label}`,
          },
        ]
      : []),
    { value: 'job', label: 'Neuer Auftrag' },
    { value: 'project', label: 'Neues Projekt' },
  ];
}

/**
 * „In Arbeit übernehmen“ of an accepted offer. Once the page shows the work
 * (`converted`) the trigger goes, but an open dialog stays until its
 * conversion has settled and its banner shows.
 */
export function ConvertOfferButton({ offer, converted }: { offer: ConvertibleOffer; converted: boolean }) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  return (
    <>
      {!converted && (
        <Button type="button" disabled={!hydrated} onClick={() => setOpen(true)}>
          In Arbeit übernehmen
        </Button>
      )}
      {open && <OfferConversionDialog offer={offer} onClose={() => setOpen(false)} />}
    </>
  );
}

function useConversion(offer: ConvertibleOffer, onClose: () => void) {
  const { showBanner } = useBanner();
  // One key per pressed choice: an unchanged press after a lost answer gets the first work.
  const attempt = usePayloadAttemptKey();
  const options = targetOptions(offer);
  const [target, setTarget] = useState<OrderTarget>(options[0]?.value ?? 'job');
  const [title, setTitle] = useState(offer.title);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  // The action's answer carries the page with the link to the work; the dialog stays pending until it is on screen.
  const settle = useSettleOnChange(offer.version);
  const [expectedVersion] = useState(offer.version);
  const titleError = target !== 'offer_work' && !title.trim() ? 'Gib einen Titel an.' : undefined;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField({ [FIELD.title]: titleError })) return;
    void run(async () => {
      setError(null);
      const since = settle.markChange();
      const values = {
        offerId: offer.id,
        expectedVersion,
        target,
        title: target === 'offer_work' ? '' : title,
      };
      const result = await ownWrites
        .track(convertOfferToWork({ ...values, attemptKey: attempt.keyFor(JSON.stringify(values)) }))
        .catch(() => null);
      if (!result?.success) {
        setError(
          result
            ? describeFailure(result.error, CONVERSION_FAILURE_MESSAGES, CONVERSION_FAILED)
            : CONVERSION_FAILED,
        );
        return;
      }
      const unplanned = result.unplannedPositions.length
        ? ` Nicht als Material geplant, weil die Einheit nicht die des Artikels ist: ${result.unplannedPositions.join(', ')}.`
        : '';
      if (await settle.confirmChange(since))
        showBanner({ variant: 'success', message: `${offer.offerNumber} ist jetzt in Arbeit.${unplanned}` });
      onClose();
    });
  };
  return {
    options,
    target,
    setTarget,
    title,
    setTitle,
    titleError: attempted ? titleError : undefined,
    error,
    isPending,
    submit,
  };
}

function OfferConversionDialog({ offer, onClose }: { offer: ConvertibleOffer; onClose: () => void }) {
  const { options, target, setTarget, title, setTitle, titleError, error, isPending, submit } = useConversion(
    offer,
    onClose,
  );
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      pending={isPending}
    >
      <DialogContent size="md">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>In Arbeit übernehmen</DialogTitle>
            <DialogDescription>
              Der Auftragsumfang wird einmal zur Arbeit: mit den Rechnungsparteien des Angebots und den
              Artikeln als geplantem Material. Geplant, zugewiesen oder versendet wird nichts.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Übernehmen als" htmlFor={FIELD.target} required>
              <Select
                value={target}
                disabled={isPending}
                onValueChange={(value) =>
                  setTarget(options.find((option) => option.value === value)?.value ?? target)
                }
              >
                <SelectTrigger id={FIELD.target} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {target !== 'offer_work' && (
              <Field label="Titel" htmlFor={FIELD.title} required error={titleError}>
                <Input
                  id={FIELD.title}
                  value={title}
                  maxLength={200}
                  disabled={isPending}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending} disabled={isPending}>
              Übernehmen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
