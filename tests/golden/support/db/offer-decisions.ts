import { createHash, randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from './shared';
import type { TestWorld } from '../world';

// A made-up sent offer with a Bedarfs- and an Alternativposition, and the
// customer's decision on it, written through the real functions: create_offer,
// save_offer_content, send_offer, accept_offer and close_offer
// (werk-flow/werkflow-planning#385). The send files a document whose stored
// object the screens never open.

/** Where the customer's decision stands: still open, accepted, rejected or withdrawn by the office. */
export type OfferDecisionStage = 'offen' | 'angenommen' | 'abgelehnt' | 'zurueckgezogen';

const priced = (fields: Record<string, unknown>) => ({
  kind: 'free',
  description: '',
  quantity: '1',
  unit: 'piece',
  unitLabel: 'Stk',
  priceQuantity: 1,
  taxRateBasisPoints: 1900,
  source: null,
  ...fields,
});

// Titel 1 „Wärmeerzeuger“: 1.1 a heat pump at 12.400,00 €, a text line, 1.2 a buffer tank at
// 980,00 € if needed, 1.3 a smaller heat pump at 10.950,00 € instead of 1.1.
// Titel 2 „Montage“: 2.1 14,5 h at 68,00 €. Only 1.1 and 2.1 count: 13.386,00 € net.
const SECTIONS = [
  {
    title: 'Wärmeerzeuger',
    netCents: 1_240_000,
    positions: [
      priced({ name: 'Luft-Wasser-Wärmepumpe 9 kW', unitPriceCents: 1_240_000, amountCents: 1_240_000 }),
      { kind: 'text', name: 'Hinweis', description: 'Der Aufstellort ist mit dem Kunden abgestimmt.' },
      priced({
        name: 'Pufferspeicher 200 l',
        unitPriceCents: 98_000,
        amountCents: 98_000,
        positionType: { kind: 'bedarf' },
      }),
      priced({
        name: 'Luft-Wasser-Wärmepumpe 7 kW',
        unitPriceCents: 1_095_000,
        amountCents: 1_095_000,
        positionType: { kind: 'alternative', alternativeTo: 1 },
      }),
    ],
  },
  {
    title: 'Montage',
    netCents: 98_600,
    positions: [
      priced({
        name: 'Montage und Inbetriebnahme',
        quantity: '14.5',
        unit: 'hour',
        unitLabel: 'Std',
        unitPriceCents: 6800,
        amountCents: 98_600,
      }),
    ],
  },
];
// 19 % on 13.386,00 € is 2.543,34 €.
const TOTALS = { netCents: 1_338_600, taxCents: 254_334, grossCents: 1_592_934, positionTypes: true };
// The Annahme with 1.2 and 1.3: 10.950,00 € + 980,00 € + 986,00 € = 12.916,00 € net, 19 % is 2.454,04 €.
const ACCEPTED_TOTALS = { netCents: 1_291_600, taxCents: 245_404, grossCents: 1_537_004 };

const berlinToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

/** Seeds one offer titled `<title> <runId>` for a made-up customer, sent once, up to `stage`; answers its id. */
export async function seedDecidedOffer(
  world: TestWorld,
  title: string,
  stage: OfferDecisionStage,
): Promise<string> {
  const admin = createAdminClient();
  const organization = { p_actor_id: world.users.buero.id, p_organization_id: world.orgId };
  const clientId = randomUUID();
  const recipient = `Hausverwaltung Zedernhof ${world.runId}`;
  await admin
    .from('clients')
    .insert({
      id: clientId,
      organization_id: world.orgId,
      name: recipient,
      address: 'Zedernallee 4, 10115 Berlin',
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
  if (!offerId) throw new Error('The offer decision fixture returned no offer.');
  await admin
    .rpc('save_offer_content', {
      ...organization,
      p_offer_id: offerId,
      p_expected_content_version: 1,
      p_attempt_key: randomUUID(),
      p_sections: SECTIONS,
      p_totals: TOTALS,
    })
    .throwOnError();
  const documentId = randomUUID();
  await admin
    .rpc('send_offer', {
      ...organization,
      p_offer_id: offerId,
      p_expected_version: 1,
      p_expected_content_version: 2,
      p_attempt_key: randomUUID(),
      p_channel: 'email',
      p_sent_on: berlinToday(),
      p_recipient_name: recipient,
      p_recipient_address: 'Zedernallee 4, 10115 Berlin',
      p_snapshot: { positionTypes: true },
      p_document_id: documentId,
      p_storage_path: `${world.orgId}/${documentId}/Angebot.pdf`,
      p_file_name: `Angebot ${offerId}.pdf`,
      p_size_bytes: 2048,
      p_content_hash: createHash('sha256').update(documentId).digest('hex'),
    })
    .throwOnError();
  if (stage === 'angenommen') {
    await admin
      .rpc('accept_offer', {
        ...organization,
        p_offer_id: offerId,
        p_expected_version: 2,
        p_attempt_key: randomUUID(),
        p_revision: 1,
        p_accepted_by_name: 'Erika Musterfrau',
        p_accepted_on: berlinToday(),
        p_channel: 'unterschrift',
        p_note: 'Unterschriebenes Angebot per Post zurück.',
        p_chosen_options: ['1.2', '1.3'],
        p_totals: ACCEPTED_TOTALS,
      })
      .throwOnError();
  }
  if (stage === 'abgelehnt' || stage === 'zurueckgezogen') {
    await admin
      .rpc('close_offer', {
        ...organization,
        p_offer_id: offerId,
        p_expected_version: 2,
        p_attempt_key: randomUUID(),
        p_outcome: stage,
        p_reason:
          stage === 'abgelehnt'
            ? 'Der Kunde hat sich für einen Gas-Brennwertkessel entschieden.'
            : 'Der Hersteller liefert die Wärmepumpe erst im Sommer.',
      })
      .throwOnError();
  }
  return offerId;
}
