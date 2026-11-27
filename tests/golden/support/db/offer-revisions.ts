import { createHash, randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from './shared';
import type { TestWorld } from '../world';

// A made-up sent offer for the audit world, written through the real
// functions: create_offer, save_offer_content, send_offer and
// start_offer_revision (werk-flow/werkflow-planning#582). Each send files a
// document whose stored object the screens never open.

/** How far the offer got: sent once, revision 2 started, or revision 2 sent too. */
export type OfferRevisionStage = 'sent' | 'editing' | 'superseded';

// 1,5 Std. at 72,50 € at 19 %; revision 2 adds a flat 18,00 €.
const FIRST = [
  {
    title: 'Wartung',
    netCents: 10_875,
    positions: [
      {
        kind: 'free',
        name: 'Wartung Gastherme',
        description: '',
        quantity: '1.5',
        unit: 'hour',
        unitLabel: 'Std',
        unitPriceCents: 7250,
        priceQuantity: 1,
        taxRateBasisPoints: 1900,
        amountCents: 10_875,
      },
    ],
  },
];
const FIRST_TOTALS = { netCents: 10_875, taxCents: 2066, grossCents: 12_941 };
const SECOND: typeof FIRST = [
  {
    title: 'Wartung',
    netCents: 12_675,
    positions: [
      ...(FIRST[0]?.positions ?? []),
      {
        kind: 'free',
        name: 'Kleinmaterial',
        description: '',
        quantity: '1',
        unit: 'flat_rate',
        unitLabel: 'psch',
        unitPriceCents: 1800,
        priceQuantity: 1,
        taxRateBasisPoints: 1900,
        amountCents: 1800,
      },
    ],
  },
];
const SECOND_TOTALS = { netCents: 12_675, taxCents: 2408, grossCents: 15_083 };

/** Seeds one offer titled `<title> <runId>` for a made-up customer up to `stage`; answers its id. */
export async function seedRevisedOffer(
  world: TestWorld,
  title: string,
  stage: OfferRevisionStage,
): Promise<string> {
  const admin = createAdminClient();
  const actor = world.users.buero.id;
  const organization = { p_actor_id: actor, p_organization_id: world.orgId };
  const clientId = randomUUID();
  const recipient = `Hausverwaltung Lindenhof ${world.runId}`;
  await admin
    .from('clients')
    .insert({
      id: clientId,
      organization_id: world.orgId,
      name: recipient,
      address: 'Hofweg 1, 10117 Berlin',
    })
    .throwOnError();
  const { data: offerId } = await admin
    .rpc(
      'create_offer',
      rpcArgs('create_offer', {
        ...organization,
        p_attempt_key: randomUUID(),
        p_title: `${title} ${world.runId}`,
        p_client_id: clientId,
        p_site_id: null,
        p_contact_id: null,
        p_work_kind: null,
        p_work_id: null,
      }),
    )
    .throwOnError();
  if (!offerId) throw new Error('The offer revision fixture returned no offer.');
  const save = (contentVersion: number, sections: typeof FIRST, totals: typeof FIRST_TOTALS) =>
    admin
      .rpc('save_offer_content', {
        ...organization,
        p_offer_id: offerId,
        p_expected_content_version: contentVersion,
        p_attempt_key: randomUUID(),
        p_sections: sections,
        p_totals: totals,
      })
      .throwOnError();
  const send = (version: number, contentVersion: number) => {
    const documentId = randomUUID();
    return admin
      .rpc('send_offer', {
        ...organization,
        p_offer_id: offerId,
        p_expected_version: version,
        p_expected_content_version: contentVersion,
        p_attempt_key: randomUUID(),
        p_channel: 'post',
        p_sent_on: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }),
        p_recipient_name: recipient,
        p_recipient_address: 'Hofweg 1, 10117 Berlin',
        p_snapshot: {},
        p_document_id: documentId,
        p_storage_path: `${world.orgId}/${documentId}/Angebot.pdf`,
        p_file_name: `Angebot ${offerId} ${version}.pdf`,
        p_size_bytes: 2048,
        p_content_hash: createHash('sha256').update(documentId).digest('hex'),
      })
      .throwOnError();
  };
  await save(1, FIRST, FIRST_TOTALS);
  await send(1, 2);
  if (stage === 'sent') return offerId;
  await admin
    .rpc('start_offer_revision', {
      ...organization,
      p_offer_id: offerId,
      p_expected_version: 2,
      p_attempt_key: randomUUID(),
    })
    .throwOnError();
  if (stage === 'editing') return offerId;
  await save(3, SECOND, SECOND_TOTALS);
  await send(3, 4);
  return offerId;
}
