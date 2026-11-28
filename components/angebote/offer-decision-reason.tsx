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
import { Textarea } from '@/components/ui/textarea';
import { useHydrated } from '@/hooks/use-hydrated';
import { usePayloadAttemptKey } from '@/hooks/use-payload-attempt-key';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { closeOffer, withdrawOfferAcceptance } from '@/lib/offers/decision-actions';
import type { OfferDetail } from '@/lib/offers/types';
import { ownWrites } from '@/lib/realtime/own-writes';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { useOfferUnsaved } from './offer-unsaved';

export const DECISION_FAILED = 'Das konnte nicht festgehalten werden. Versuche es erneut.';
export const DECISION_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  save_failed: DECISION_FAILED,
  offer_changed: 'Jemand hat das Angebot gerade geändert. Lade die Seite neu.',
  offer_decided: 'Für das Angebot ist schon eine Entscheidung erfasst. Lade die Seite neu.',
  offer_not_accepted: 'Das Angebot ist nicht mehr angenommen. Lade die Seite neu.',
  offer_converted: 'Aus der Annahme ist schon Arbeit entstanden. Sie lässt sich nicht mehr zurücknehmen.',
  offer_not_sent: 'Das Angebot wurde noch nicht gesendet.',
  offer_not_found: 'Das Angebot gibt es nicht mehr.',
  revision_superseded: 'Inzwischen ist eine neuere Revision gesendet. Lade die Seite neu.',
  scope_mismatch: DECISION_FAILED,
};

/**
 * On the draft of the next revision: the decision is on the sent revision, so the draft closes
 * unsent, and what its editor holds unsaved is lost with it.
 */
export function OfferDraftClosingNote({ children }: { children: React.ReactNode }) {
  const unsaved = useOfferUnsaved();
  return (
    <p className="text-sm text-muted-foreground">
      {children}
      {unsaved && ' Was du an den Positionen noch nicht gespeichert hast, geht dabei verloren.'}
    </p>
  );
}

type DecidableOffer = Pick<OfferDetail, 'id' | 'offerNumber' | 'version' | 'status'>;

/** What each reason step records, says and confirms. */
const STEPS = {
  abgelehnt: {
    trigger: 'Ablehnung erfassen',
    title: 'Ablehnung erfassen',
    description:
      'Halte fest, dass der Kunde das Angebot abgelehnt hat. Danach lässt es sich nicht mehr annehmen oder bearbeiten.',
    banner: 'ist als abgelehnt erfasst.',
  },
  zurueckgezogen: {
    trigger: 'Zurückziehen',
    title: 'Angebot zurückziehen',
    description:
      'Halte fest, dass du das Angebot zurückziehst. Danach lässt es sich nicht mehr annehmen oder bearbeiten.',
    banner: 'ist zurückgezogen.',
  },
  annahme: {
    trigger: 'Annahme zurücknehmen',
    title: 'Annahme zurücknehmen',
    description:
      'Nimm eine irrtümlich erfasste Annahme zurück. Sie bleibt im Verlauf, als zurückgenommen markiert, und das Angebot gilt wieder als gesendet.',
    banner: 'gilt wieder als gesendet.',
  },
} as const;

/**
 * A step that needs a reason: „Ablehnung erfassen“, „Zurückziehen“ of a sent
 * offer, or „Annahme zurücknehmen“ of a mistaken Annahme.
 */
export function OfferReasonButton({ offer, step }: { offer: DecidableOffer; step: keyof typeof STEPS }) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" disabled={!hydrated} onClick={() => setOpen(true)}>
        {STEPS[step].trigger}
      </Button>
      {open && <OfferReasonDialog offer={offer} step={step} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The reason, its field error once submitted, and the submit that records the step. */
function useReasonStep(offer: DecidableOffer, step: keyof typeof STEPS, onClose: () => void) {
  const { showBanner } = useBanner();
  // One key per pressed reason: an unchanged press after a lost answer gets the first record, and a
  // corrected reason is a new attempt, which a recorded decision refuses instead of answering.
  const attempt = usePayloadAttemptKey();
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  // The action's answer carries the page with the decision; the dialog stays pending until it is on screen.
  const settle = useSettleOnChange(offer.version);
  // The version the office opened the dialog on: a page refresh while it is open never moves the
  // decision onto a state the office did not see; a changed offer refuses it.
  const [expectedVersion] = useState(offer.version);
  const reasonError = reason.trim() ? undefined : 'Gib einen Grund an.';
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField({ 'offer-decision-reason': reasonError })) return;
    void run(async () => {
      setError(null);
      const since = settle.markChange();
      const values = { offerId: offer.id, expectedVersion, reason };
      const input = { ...values, attemptKey: attempt.keyFor(JSON.stringify(values)) };
      // Recorded, so this tab skips the Realtime echo of its own write (lib/realtime/own-writes.ts).
      const result = await ownWrites
        .track(step === 'annahme' ? withdrawOfferAcceptance(input) : closeOffer({ ...input, outcome: step }))
        .catch(() => null);
      if (!result?.success) {
        setError(
          result
            ? describeFailure(result.error, DECISION_FAILURE_MESSAGES, DECISION_FAILED)
            : DECISION_FAILED,
        );
        return;
      }
      // A view that did not settle already says so; success shows only for a settled view.
      if (await settle.confirmChange(since))
        showBanner({ variant: 'success', message: `${offer.offerNumber} ${STEPS[step].banner}` });
      onClose();
    });
  };
  return { reason, setReason, reasonError: attempted ? reasonError : undefined, error, isPending, submit };
}

function OfferReasonDialog({
  offer,
  step,
  onClose,
}: {
  offer: DecidableOffer;
  step: keyof typeof STEPS;
  onClose: () => void;
}) {
  const { reason, setReason, reasonError, error, isPending, submit } = useReasonStep(offer, step, onClose);
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
            <DialogTitle>{STEPS[step].title}</DialogTitle>
            <DialogDescription>{STEPS[step].description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            {offer.status === 'entwurf' && (
              <OfferDraftClosingNote>
                Der Entwurf der nächsten Revision wird damit geschlossen, und seine Änderungen werden nicht
                gesendet.
              </OfferDraftClosingNote>
            )}
            <Field label="Grund" htmlFor="offer-decision-reason" required error={reasonError}>
              <Textarea
                id="offer-decision-reason"
                value={reason}
                maxLength={2000}
                disabled={isPending}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending} disabled={isPending}>
              {STEPS[step].title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
