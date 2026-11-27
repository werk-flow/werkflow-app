import { createHash, randomUUID } from 'node:crypto';
import { getBusinessTodayIso } from '../../../lib/date-time/berlin';
import { rpcArgs } from '../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../golden/support/db/shared';
import type { TestWorld } from '../../golden/support/world';

// An offer sent twice for the audit world, written through E2a's database
// functions as „Als gesendet festhalten“ writes them, with a filed stand-in
// PDF per revision that no capture opens: revision 1 is replaced by
// revision 2. No screen starts revision 2 yet (werk-flow/werkflow-planning#582),
// so the fixture reopens the draft as that step will. `delivered` also emails
// the revisions as the delivery module records it: revision 1 once while it
// is the newest, and revision 2 once out and once refused by the provider.

const CUSTOMER = 'Hausverwaltung Lindenhof GmbH';
const TITLE = 'Heizungstausch';

const SECTIONS = [
  {
    title: 'Heizung',
    netCents: 18_900,
    positions: [
      {
        kind: 'free',
        name: 'Wartung Gastherme',
        description: '',
        quantity: '1',
        unit: 'flat_rate',
        unitLabel: 'psch',
        unitPriceCents: 18_900,
        priceQuantity: 1,
        taxRateBasisPoints: 1900,
        amountCents: 18_900,
      },
    ],
  },
];
const TOTALS = { netCents: 18_900, taxCents: 3591, grossCents: 22_491 };

function field(value: unknown, key: string): unknown {
  const found: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, key) : null;
  if (found === null || found === undefined) throw new Error(`offer delivery fixture answered no ${key}`);
  return found;
}

/**
 * The offer sent as revision 1, then as revision 2; `betweenSends` runs while
 * revision 1 is still the newest, as an email of it must.
 */
async function sentTwice(
  world: TestWorld,
  state: string,
  betweenSends: (offerId: string) => Promise<void>,
): Promise<{ offerId: string; customer: string }> {
  const admin = createAdminClient();
  const actor = world.users.buero.id;
  const orgId = world.orgId;
  const clientId = randomUUID();
  const customer = `${CUSTOMER} ${state} ${world.runId}`;
  await admin
    .from('clients')
    .insert({
      id: clientId,
      organization_id: orgId,
      name: customer,
      address: 'Hofweg 1, 10117 Berlin',
      email: 'verwaltung@lindenhof.example',
    })
    .throwOnError();
  const { data: created } = await admin
    .rpc(
      'create_offer',
      rpcArgs('create_offer', {
        p_actor_id: actor,
        p_organization_id: orgId,
        p_attempt_key: randomUUID(),
        p_title: `${TITLE} ${world.runId}`,
        p_client_id: clientId,
        p_site_id: null,
        p_contact_id: null,
        p_work_kind: null,
        p_work_id: null,
      }),
    )
    .throwOnError();
  const offerId = String(field({ id: created }, 'id'));
  const save = (contentVersion: number) =>
    admin
      .rpc('save_offer_content', {
        p_actor_id: actor,
        p_organization_id: orgId,
        p_offer_id: offerId,
        p_expected_content_version: contentVersion,
        p_attempt_key: randomUUID(),
        p_sections: SECTIONS,
        p_totals: TOTALS,
      })
      .throwOnError();
  const send = async (version: number, contentVersion: number, channel: string) => {
    const documentId = randomUUID();
    await admin
      .rpc('send_offer', {
        p_actor_id: actor,
        p_organization_id: orgId,
        p_offer_id: offerId,
        p_expected_version: version,
        p_expected_content_version: contentVersion,
        p_attempt_key: randomUUID(),
        p_channel: channel,
        p_sent_on: getBusinessTodayIso(),
        p_recipient_name: customer,
        p_recipient_address: 'Hofweg 1, 10117 Berlin',
        p_snapshot: {},
        p_document_id: documentId,
        p_storage_path: `${orgId}/${documentId}/Angebot.pdf`,
        p_file_name: `Angebot ${version}.pdf`,
        p_size_bytes: 2048,
        p_content_hash: createHash('sha256').update(documentId).digest('hex'),
      })
      .throwOnError();
  };
  await save(1);
  await send(1, 2, 'post');
  await betweenSends(offerId);
  await admin
    .from('offers')
    .update({ status: 'entwurf' })
    .eq('organization_id', orgId)
    .eq('id', offerId)
    .throwOnError();
  await save(2);
  await send(2, 3, 'download');
  return { offerId, customer };
}

/** An email delivery of revision `revision`, settled as the transport answered. */
async function emailed(
  world: TestWorld,
  offerId: string,
  revision: number,
  answer: { messageId: string } | { failureCode: string },
): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('offer_revisions')
    .select('id, document_id, offer_number')
    .eq('organization_id', world.orgId)
    .eq('offer_id', offerId)
    .eq('revision', revision)
    .single()
    .throwOnError();
  const { data } = await admin
    .rpc(
      'request_document_delivery',
      rpcArgs('request_document_delivery', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_attempt_key: randomUUID(),
        p_subject_kind: 'offer_revision',
        p_subject_id: row.id,
        p_document_id: row.document_id,
        p_recipient_email: 'verwaltung@lindenhof.example',
        p_email_subject: `Angebot ${row.offer_number} – Haustechnik Sonnenberg GmbH`,
        p_message_text: `Guten Tag,\n\nanbei unser Angebot ${row.offer_number}.`,
        p_sender_name: 'Haustechnik Sonnenberg GmbH',
        p_from_header: '"Haustechnik Sonnenberg GmbH" <noreply@werkflow.test>',
        p_reply_to: null,
      }),
    )
    .throwOnError();
  await admin
    .rpc(
      'settle_document_delivery',
      rpcArgs('settle_document_delivery', {
        p_organization_id: world.orgId,
        p_delivery_id: String(field(data, 'deliveryId')),
        p_attempt: 1,
        p_outcome: 'messageId' in answer ? 'sent' : 'failed',
        p_provider_message_id: 'messageId' in answer ? answer.messageId : null,
        p_failure_code: 'failureCode' in answer ? answer.failureCode : null,
      }),
    )
    .throwOnError();
}

type OfferDeliverySeedState = 'fresh' | 'delivered';

/**
 * The seed of an offer sent twice for `surfaceFixture`: `fresh` was never
 * emailed, `delivered` was as the header says. `parseOfferDeliverySeed` reads
 * back what `create` stored.
 */
export function offerDeliverySeed(
  world: TestWorld,
  state: OfferDeliverySeedState,
): { name: `commercial.offer-delivery-${OfferDeliverySeedState}`; create: () => Promise<string> } {
  return {
    name: `commercial.offer-delivery-${state}`,
    create: async () => {
      const { offerId } = await sentTwice(world, state, async (sent) => {
        if (state === 'delivered') await emailed(world, sent, 1, { messageId: randomUUID() });
      });
      if (state === 'delivered') {
        await emailed(world, offerId, 2, { messageId: randomUUID() });
        await emailed(world, offerId, 2, { failureCode: 'email_provider_503' });
      }
      return JSON.stringify({ id: offerId, heading: `${TITLE} ${world.runId}` });
    },
  };
}

/** The offer id and page heading a seed stored. */
export function parseOfferDeliverySeed(value: string): { id: string; heading: string } {
  const parsed: unknown = JSON.parse(value);
  return { id: String(field(parsed, 'id')), heading: String(field(parsed, 'heading')) };
}
