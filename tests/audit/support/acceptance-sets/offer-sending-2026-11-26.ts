import { createHash, randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';

// Amounts as lib/offers/amounts.ts computes them: 1,5 Std. at 72,50 € and a flat 18,00 € at 19 %.
const SECTIONS = [
  {
    title: 'Wartung',
    netCents: 12_675,
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
      { kind: 'text', name: 'Hinweis', description: 'Ersatzteile rechnen wir nach Aufwand ab.' },
    ],
  },
];
const TOTALS = { netCents: 12_675, taxCents: 2408, grossCents: 15_083 };

type Seeded = { draft: string; revised: string; expired: string };

/**
 * A made-up customer with three offers: a draft to preview and send, one sent
 * twice (revision 1 replaced by revision 2) and one sent whose validity has
 * since passed. The sends go through send_offer with a document that names an
 * object the capture never opens.
 */
async function seedOffers(world: TestWorld): Promise<Seeded> {
  const value = await surfaceFixture(world, 'commercial.acceptance-offer-sending', async () => {
    const admin = createAdminClient();
    const actor = world.users.buero.id;
    const clientId = randomUUID();
    await admin
      .from('clients')
      .insert({
        id: clientId,
        organization_id: world.orgId,
        name: `Hausverwaltung Lindenhof ${world.runId}`,
        address: 'Hofweg 1, 10117 Berlin',
      })
      .throwOnError();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const create = async (title: string): Promise<string> => {
      const { data } = await admin
        .rpc(
          'create_offer',
          rpcArgs('create_offer', {
            p_actor_id: actor,
            p_organization_id: world.orgId,
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
      if (!data) throw new Error('The offer fixture returned no offer.');
      return data;
    };
    const save = async (offerId: string, contentVersion: number) =>
      admin
        .rpc('save_offer_content', {
          p_actor_id: actor,
          p_organization_id: world.orgId,
          p_offer_id: offerId,
          p_expected_content_version: contentVersion,
          p_attempt_key: randomUUID(),
          p_sections: SECTIONS,
          p_totals: TOTALS,
        })
        .throwOnError();
    const send = async (offerId: string, version: number, contentVersion: number, channel: string) => {
      const documentId = randomUUID();
      await admin
        .rpc('send_offer', {
          p_actor_id: actor,
          p_organization_id: world.orgId,
          p_offer_id: offerId,
          p_expected_version: version,
          p_expected_content_version: contentVersion,
          p_attempt_key: randomUUID(),
          p_channel: channel,
          p_sent_on: today,
          p_recipient_name: `Hausverwaltung Lindenhof ${world.runId}`,
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
    const draft = await create('Wartung Gasheizung');
    await save(draft, 1);
    const revised = await create('Heizungstausch');
    await save(revised, 1);
    await send(revised, 1, 2, 'post');
    // No screen starts revision 2 yet: the fixture reopens the draft as that step will.
    await admin
      .from('offers')
      .update({ status: 'entwurf' })
      .eq('organization_id', world.orgId)
      .eq('id', revised)
      .throwOnError();
    await save(revised, 2);
    await send(revised, 2, 3, 'email');
    const expired = await create('Wartung Fußbodenheizung');
    await save(expired, 1);
    await send(expired, 1, 2, 'persoenlich');
    await admin
      .from('offers')
      .update({ valid_until: '2020-01-31' })
      .eq('organization_id', world.orgId)
      .eq('id', expired)
      .throwOnError();
    return JSON.stringify({ draft, revised, expired });
  });
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('draft' in parsed && 'revised' in parsed && 'expired' in parsed)
  )
    throw new Error('The offer sending fixture is malformed.');
  return { draft: String(parsed.draft), revised: String(parsed.revised), expired: String(parsed.expired) };
}

const TITLES: Record<keyof Seeded, string> = {
  draft: 'Wartung Gasheizung',
  revised: 'Heizungstausch',
  expired: 'Wartung Fußbodenheizung',
};

function offerPage(kind: keyof Seeded) {
  return async (world: TestWorld): Promise<SurfaceDestination> => {
    const ids = await seedOffers(world);
    return { route: `/angebote/${ids[kind]}`, heading: `${TITLES[kind]} ${world.runId}` };
  };
}

type SetCapture = OpenSet['captures'][number];

/**
 * werk-flow/werkflow-planning#383 of 2026-11-26: a draft's „Vorschau“ with
 * the PDF inside the page, while it renders and when it fails, the dialog
 * „Als gesendet festhalten“, an offer sent twice with revision 1 replaced,
 * and a sent offer past its validity („Abgelaufen“), for Admin and Büro. The
 * page before the change is `offer-positions-2026-11-26`'s `<role>-wartung`.
 * The Musterangebot inline is `document-sample-2026-11-12`.
 */
function roleCaptures(role: 'admin' | 'buero'): SetCapture[] {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const route = '/angebote/[offerId]' as const;
  const preview = { kind: 'dialog', opener: 'commercial.offer-preview' } as const;
  const draft = { role, route, destination: offerPage('draft'), ...both } as const;
  return [
    { id: `${role}-entwurf`, ...draft, view: { kind: 'page' } },
    { id: `${role}-vorschau`, ...draft, view: preview },
    { id: stateCaptureId(`${role}-vorschau`, 'loading'), ...draft, view: preview, state: 'loading' },
    { id: stateCaptureId(`${role}-vorschau`, 'error'), ...draft, view: preview, state: 'error' },
    { id: `${role}-senden`, ...draft, view: { kind: 'dialog', opener: 'commercial.offer-send' } },
    {
      id: `${role}-revisionen`,
      role,
      route,
      destination: offerPage('revised'),
      view: { kind: 'page' },
      reveal: 'Ersetzt durch Revision 2',
      ...both,
    },
    {
      id: `${role}-abgelaufen`,
      role,
      route,
      destination: offerPage('expired'),
      view: { kind: 'page' },
      ...both,
    },
  ];
}

acceptanceSet({
  id: 'offer-sending-2026-11-26',
  captures: [...roleCaptures('admin'), ...roleCaptures('buero')],
  standalone: [],
});
