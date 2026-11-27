'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { startOfferRevision } from '@/lib/offers/actions';
import type { OfferDetail } from '@/lib/offers/types';

const START_FAILED = 'Die neue Revision konnte nicht angelegt werden. Versuche es erneut.';
const START_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  save_failed: START_FAILED,
  offer_changed: 'Jemand hat das Angebot gerade geändert. Lade die Seite neu.',
  offer_not_sent: 'Das Angebot wird schon bearbeitet. Lade die Seite neu.',
  offer_not_found: 'Das Angebot gibt es nicht mehr.',
};

/**
 * „Bearbeiten“ of a sent offer: after a confirmation the offer becomes the
 * draft of its next revision, with the Positionen as sent. The sent revision
 * stays as it was and stays valid until the next one is recorded as sent.
 */
export function StartOfferRevisionButton({
  offer,
  sentRevision,
}: {
  offer: Pick<OfferDetail, 'id' | 'offerNumber' | 'version'>;
  /** The newest sent revision, which the draft follows. */
  sentRevision: number;
}) {
  const hydrated = useHydrated();
  const { showBanner } = useBanner();
  // One key per page of the sent offer: a press repeated after a lost answer gets the first start.
  const [attemptKey] = useState(() => crypto.randomUUID());
  // The action's answer carries the page with the draft; the dialog stays pending until it is on screen.
  const settle = useSettleOnChange(offer.version);
  const next = sentRevision + 1;
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm" disabled={!hydrated}>
          <Pencil className="size-4" />
          Bearbeiten
        </Button>
      }
      title={`Revision ${next} bearbeiten?`}
      description={
        <p>
          {`Revision ${sentRevision} bleibt so, wie du sie gesendet hast, mit ihrem PDF. Du bearbeitest einen Entwurf für Revision ${next}. Bis du ihn als gesendet festhältst, gilt Revision ${sentRevision}.`}
        </p>
      }
      confirmLabel={`Revision ${next} bearbeiten`}
      onConfirm={async () => {
        const since = settle.markChange();
        const result = await startOfferRevision({
          offerId: offer.id,
          expectedVersion: offer.version,
          attemptKey,
        }).catch(() => null);
        if (!result?.success) {
          return result ? describeFailure(result.error, START_FAILURE_MESSAGES, START_FAILED) : START_FAILED;
        }
        await settle(since);
        showBanner({
          variant: 'success',
          message: `${offer.offerNumber} ist ein Entwurf für Revision ${result.revision}. Revision ${result.revision - 1} gilt, bis du ihn als gesendet festhältst.`,
        });
        return null;
      }}
    />
  );
}
