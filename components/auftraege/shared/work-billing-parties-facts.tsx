'use client';

import { TextLink } from '@/components/ui/text-link';
import type { BillingPartySource } from '@/lib/billing-parties/types';
import type { ResolvedBillingVersion } from '@/lib/billing-parties/resolve';
import { formatBerlinDateTime } from '@/lib/utils';

// The facts the job section and the request's Details rows both show. A
// module of their own, so the request page does not carry the section with
// its live read and dialog loader.

/** Why this recipient: shown under it on the work. */
const SOURCE_LABELS: Readonly<Record<BillingPartySource, string>> = {
  objekt: 'Rechnungsempfänger des Einsatzorts',
  auftraggeber: 'Wie Auftraggeber',
  projekt: 'Aus dem Projekt übernommen',
  anfrage: 'Aus der Anfrage übernommen',
  buero: 'Vom Büro gewählt',
};

/** A party's name, linked to its customer only where the page does not link it already. */
export function partyName(party: { id: string; name: string }, linked: boolean): React.ReactNode {
  return linked ? <TextLink href={`/kunden/${party.id}`}>{party.name}</TextLink> : party.name;
}

/** The recipient as it was copied onto the work, and why and when. */
export function RecipientFact({ current, linked }: { current: ResolvedBillingVersion; linked: boolean }) {
  return (
    <>
      {partyName(current.recipient, linked)}
      {current.recipient.address && (
        <span className="block whitespace-pre-line text-muted-foreground">{current.recipient.address}</span>
      )}
      <span className="block text-xs text-muted-foreground">
        {SOURCE_LABELS[current.source]} · {formatBerlinDateTime(current.setAt)}
      </span>
    </>
  );
}
