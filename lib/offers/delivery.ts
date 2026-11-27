import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { readDeliverySender, type DeliveryCaller } from '@/lib/delivery/document-delivery';
import { DELIVERY_LIMITS, type DeliveryMailDefaults } from '@/lib/delivery/delivery-types';
import { readRecipientEmail } from '@/lib/delivery/recipient-email';
import { readDocumentDeliveries } from '@/lib/delivery/reads';
import { formatEuroCents } from '@/lib/document-rendering/format';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { formatGermanDate } from '@/lib/utils';

import type { OfferRevisionDelivery } from './delivery-types';

// A sent offer revision as E2c's delivery sends it (lib/delivery/): the
// subject `offer_revision` with the revision's own filed PDF, read on the
// server after the caller's manager check, never a document the client
// names. lock_delivery_document checks the organization again, and that no
// later revision replaced it. E2a's offer and revisions are only read.

type RevisionRow = {
  id: string;
  revision: number;
  document_id: string;
  offer_number: string;
  title: string;
  valid_until: string;
  gross_cents: number;
  recipient_client_id: string;
};

/** The next revision, which replaced this one; null while it is the newest. */
type DeliveryRevision = RevisionRow & { replacedBy: number | null };

/**
 * Revision `revision` of the caller's organization's offer, and whether a
 * later one replaced it; null when there is none. A failed read throws.
 */
export async function readDeliveryRevision(
  caller: DeliveryCaller,
  offer: { offerId: string; revision: number },
): Promise<DeliveryRevision | null> {
  const { data, error } = await loggedRead(
    'readDeliveryRevision: revision read failed',
    createSupabaseAdminClient()
      .from('offer_revisions')
      .select('id, revision, document_id, offer_number, title, valid_until, gross_cents, recipient_client_id')
      .eq('organization_id', caller.orgId)
      .eq('offer_id', offer.offerId)
      .gte('revision', offer.revision)
      .order('revision')
      .limit(2),
  );
  if (error) throw new Error('offer_revision_read_failed');
  const [own, later] = data ?? [];
  if (!own || own.revision !== offer.revision) return null;
  return { ...own, replacedBy: later?.revision ?? null };
}

/**
 * The subject cut to the send's limit between whole characters, never inside
 * one, so the number stays whole and a long company name is shortened.
 */
function fitSubject(subject: string): string {
  let fitted = '';
  for (const character of subject) {
    if (fitted.length + character.length > DELIVERY_LIMITS.subject) break;
    fitted += character;
  }
  return fitted.trim();
}

/**
 * What „Per E-Mail senden“ proposes: the address of the offer's
 * Ansprechpartner at the Rechnungsempfänger the revision printed, else that
 * customer's own, else its main contact's; a subject and a text naming
 * number, title, amount and validity, signed with the sender's name. A failed
 * read throws.
 */
async function readOfferMailDefaults(
  caller: DeliveryCaller,
  offerId: string,
  revision: RevisionRow,
): Promise<DeliveryMailDefaults> {
  const offer = await loggedRead(
    'readOfferMailDefaults: offer read failed',
    createSupabaseAdminClient()
      .from('offers')
      .select('contact_id')
      .eq('organization_id', caller.orgId)
      .eq('id', offerId)
      .maybeSingle(),
  );
  if (offer.error) throw new Error('offer_read_failed');
  const [recipient, sender] = await Promise.all([
    readRecipientEmail(caller.orgId, {
      clientId: revision.recipient_client_id,
      contactId: offer.data?.contact_id ?? null,
    }),
    readDeliverySender(caller),
  ]);
  if (!sender) throw new Error('delivery_sender_read_failed');
  const named =
    revision.revision > 1
      ? `${revision.offer_number} (Revision ${revision.revision})`
      : revision.offer_number;
  return {
    recipient,
    subject: fitSubject(`Angebot ${revision.offer_number} – ${sender.name}`),
    text: [
      'Guten Tag,',
      `anbei unser Angebot ${named} „${revision.title}“ über ${formatEuroCents(revision.gross_cents)}, gültig bis ${formatGermanDate(revision.valid_until)}.`,
      `Mit freundlichen Grüßen\n${sender.name}`,
    ].join('\n\n'),
  };
}

/**
 * The revision's deliveries from E2c's reader, what the email form proposes,
 * and the revision that replaced it, so a stale page's dialog turns
 * read-only. A failed proposal leaves the sends readable: defaults are then
 * null. A replacement after this read is the database's refusal.
 */
export async function readOfferRevisionDelivery(
  caller: DeliveryCaller,
  offer: { offerId: string; revision: number },
): Promise<ActionResult<{ delivery: OfferRevisionDelivery }, 'load_failed' | 'offer_revision_not_found'>> {
  const revision = await readDeliveryRevision(caller, offer).catch((error: unknown) => {
    logError('readOfferRevisionDelivery: revision read failed', error);
    return 'failed' as const;
  });
  if (revision === 'failed') return { success: false, error: 'load_failed' };
  if (!revision) return { success: false, error: 'offer_revision_not_found' };
  const [list, defaults] = await Promise.allSettled([
    readDocumentDeliveries(caller.orgId, { kind: 'offer_revision', id: revision.id }),
    readOfferMailDefaults(caller, offer.offerId, revision),
  ]);
  if (list.status === 'rejected') {
    logError('readOfferRevisionDelivery: delivery list read failed', list.reason);
    return { success: false, error: 'load_failed' };
  }
  if (defaults.status === 'rejected')
    logError('readOfferRevisionDelivery: mail defaults failed', defaults.reason);
  return {
    success: true,
    delivery: {
      list: list.value,
      defaults: defaults.status === 'fulfilled' ? defaults.value : null,
      replacedBy: revision.replacedBy,
    },
  };
}
