// The real offer actions and pages over the in-memory database: a field
// worker is refused before any database access, another organization's
// customer, offer or recipient is refused by the one database function the
// action calls, the office's writes carry their own organization and actor,
// and the pages read only the caller's organization.
// supabase/tests/offers.sql and offer_sending.sql prove the functions' refusals, grants and history.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';
import { installPageWorld, refusal, renderTree } from './page-render';

const ownClientId = '94000000-0000-4000-8000-000000000001';
const foreignClientId = '94000000-0000-4000-8000-000000000009';
const ownOfferId = '95000000-0000-4000-8000-000000000001';
const foreignOfferId = '95000000-0000-4000-8000-000000000009';

const world = await installPageWorld({ offers: [], offer_events: [] });
const revalidated: string[] = [];
mock.module('next/cache', () => ({
  updateTag: () => {},
  revalidatePath: (path: string) => revalidated.push(path),
  revalidateTag: () => {},
}));

const { createOffer, saveOfferContent, startOfferRevision, updateOffer } = await import(
  '@/lib/offers/actions'
);
const { default: OffersPage } = await import('@/app/(app)/angebote/page');
const { default: OfferPage } = await import('@/app/(app)/angebote/[offerId]/page');

const create = {
  attemptKey: '96000000-0000-4000-8000-000000000001',
  title: 'Austausch Gastherme',
  siteId: null,
  contactId: null,
};
// A field worker neither writes an offer nor opens a page of them.
signInAs(world, 'employee');
await assertRefused(
  world,
  [['createOffer', () => createOffer({ ...create, clientId: ownClientId })]],
  { success: false, error: 'not_authorized' },
  'none',
);
world.adminClientRequests = 0;
assert.equal(await refusal(() => OffersPage({ searchParams: Promise.resolve({}) })), 'redirect:/dashboard');
assert.equal(
  await refusal(() => OfferPage({ params: Promise.resolve({ offerId: ownOfferId }) })),
  'redirect:/dashboard',
);
assert.equal(world.adminClientRequests, 0, 'a refused page reached the database');

// Another organization's customer is refused by the one function call, with its code.
signInAs(world, 'buero');
refuseForeignIds(world, new Map([[foreignClientId, 'client_not_found']]), ownOfferId);
await assertRefused(
  world,
  [['createOffer foreign customer', () => createOffer({ ...create, clientId: foreignClientId })]],
  { success: false, error: 'client_not_found' },
  'one-call',
);

// A missing title or a bad id never reaches the database.
await assertRefused(
  world,
  [
    ['createOffer without title', () => createOffer({ ...create, title: '  ', clientId: ownClientId })],
    ['createOffer bad customer id', () => createOffer({ ...create, clientId: 'not-a-uuid' })],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

// Büro creates in its own organization, as itself, in one database call.
world.rpcCalls.length = 0;
assert.deepEqual(await createOffer({ ...create, clientId: ownClientId }), {
  success: true,
  offerId: ownOfferId,
});
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_actor_id]),
  [['create_offer', ORGANIZATION_A, CALLER_ID]],
);

// The header change: a field worker is refused before the database, another
// organization's offer or recipient by the one function call, and Büro saves
// its own offer as itself.
const header = {
  offerId: ownOfferId,
  expectedVersion: 1,
  attemptKey: '96000000-0000-4000-8000-000000000002',
  title: 'Austausch Gastherme',
  siteId: null,
  contactId: null,
  recipientClientId: null,
  validUntil: '2026-12-31',
  openingText: '',
  closingText: '',
  ownerUserId: CALLER_ID,
};
signInAs(world, 'employee');
await assertRefused(
  world,
  [['updateOffer', () => updateOffer(header)]],
  { success: false, error: 'not_authorized' },
  'none',
);
signInAs(world, 'buero');
refuseForeignIds(
  world,
  new Map([
    [foreignOfferId, 'offer_not_found'],
    [foreignClientId, 'recipient_not_found'],
  ]),
  { version: 2, updatedAt: '2026-11-23T08:00:00.123456+00:00' },
);
await assertRefused(
  world,
  [['updateOffer foreign offer', () => updateOffer({ ...header, offerId: foreignOfferId })]],
  { success: false, error: 'offer_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['updateOffer foreign recipient', () => updateOffer({ ...header, recipientClientId: foreignClientId })]],
  { success: false, error: 'recipient_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [
    ['updateOffer without title', () => updateOffer({ ...header, title: '  ' })],
    ['updateOffer bad offer id', () => updateOffer({ ...header, offerId: 'not-a-uuid' })],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);
world.rpcCalls.length = 0;
assert.deepEqual(await updateOffer(header), {
  success: true,
  offerId: ownOfferId,
  version: 2,
  updatedAt: '2026-11-23T08:00:00.123456+00:00',
});
assert.deepEqual(
  world.rpcCalls.map((call) => [
    call.name,
    call.args.p_organization_id,
    call.args.p_actor_id,
    call.args.p_offer_id,
  ]),
  [['update_offer', ORGANIZATION_A, CALLER_ID, ownOfferId]],
);

// The content save: a field worker is refused before the database, another
// organization's offer by the one function call, and Büro saves its own
// offer as itself with the amounts the server computed, which leave out its
// Bedarfs- and Alternativposition.
const servicePosition = {
  kind: 'free' as const,
  positionType: { kind: 'normal' as const },
  name: 'Wartung Gastherme',
  description: '',
  quantity: '1.5',
  unit: 'hour',
  unitPriceCents: 7250,
  priceQuantity: 1 as const,
  taxRateBasisPoints: 1900 as const,
  cost: null,
  priceSource: { kind: 'manuell' as const },
};
const content = {
  offerId: ownOfferId,
  expectedContentVersion: 1,
  attemptKey: '96000000-0000-4000-8000-000000000003',
  sections: [
    {
      title: 'Wartung',
      positions: [
        servicePosition,
        { kind: 'text' as const, name: 'Hinweis', description: 'Ersatzteile nach Aufwand.' },
        { ...servicePosition, name: 'Abgasmessung', positionType: { kind: 'bedarf' as const } },
        {
          ...servicePosition,
          name: 'Wartung mit Brennerreinigung',
          positionType: { kind: 'alternative' as const, alternativeTo: 1 },
        },
        {
          kind: 'adjustment' as const,
          name: 'Nachlass',
          description: '',
          adjustment: { direction: 'rabatt' as const, scope: 'titel' as const, percentHundredths: 300 },
        },
      ],
    },
  ],
};
signInAs(world, 'employee');
await assertRefused(
  world,
  [['saveOfferContent', () => saveOfferContent(content)]],
  { success: false, error: 'not_authorized' },
  'none',
);
signInAs(world, 'buero');
refuseForeignIds(world, new Map([[foreignOfferId, 'offer_not_found']]), {
  contentVersion: 2,
  updatedAt: '2026-11-26T08:00:00.123456+00:00',
});
await assertRefused(
  world,
  [['saveOfferContent foreign offer', () => saveOfferContent({ ...content, offerId: foreignOfferId })]],
  { success: false, error: 'offer_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [
    ['saveOfferContent bad offer id', () => saveOfferContent({ ...content, offerId: 'not-a-uuid' })],
    [
      'saveOfferContent four decimals',
      () =>
        saveOfferContent({
          ...content,
          sections: [{ title: 'Wartung', positions: [{ ...servicePosition, quantity: '1.2345' }] }],
        }),
    ],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);
world.rpcCalls.length = 0;
assert.deepEqual(await saveOfferContent(content), {
  success: true,
  offerId: ownOfferId,
  contentVersion: 2,
  updatedAt: '2026-11-26T08:00:00.123456+00:00',
});
assert.deepEqual(
  world.rpcCalls.map((call) => [
    call.name,
    call.args.p_organization_id,
    call.args.p_actor_id,
    call.args.p_offer_id,
    call.args.p_totals,
    JSON.stringify(call.args.p_sections).match(/"positionType":\{[^}]*\}|"taxSplit":\[[^\]]*\]/g),
  ]),
  [
    [
      'save_offer_content',
      ORGANIZATION_A,
      CALLER_ID,
      ownOfferId,
      // 1,5 h at 72,50 € is 108,75 €, less 3 % (3,2625 €, so 3,26 €): 105,49 €; 19 % VAT on it is 20,0431 €.
      { netCents: 10549, taxCents: 2004, grossCents: 12553, positionTypes: true, adjustments: true },
      [
        '"positionType":{"kind":"normal"}',
        '"positionType":{"kind":"bedarf"}',
        '"positionType":{"kind":"alternative","alternativeTo":1}',
        '"taxSplit":[{"taxRateBasisPoints":1900,"amountCents":-326}]',
      ],
    ],
  ],
);

// „Bearbeiten“ of a sent offer: a field worker is refused before the database,
// another organization's offer by the one function call, and Büro starts the
// next revision of its own offer as itself.
const start = {
  offerId: ownOfferId,
  expectedVersion: 2,
  attemptKey: '96000000-0000-4000-8000-000000000004',
};
signInAs(world, 'employee');
await assertRefused(
  world,
  [['startOfferRevision', () => startOfferRevision(start)]],
  { success: false, error: 'not_authorized' },
  'none',
);
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  refuseForeignIds(world, new Map([[foreignOfferId, 'offer_not_found']]), {
    revision: 2,
    version: 3,
    updatedAt: '2026-11-27T08:00:00.123456+00:00',
    replay: false,
  });
  await assertRefused(
    world,
    [['startOfferRevision foreign offer', () => startOfferRevision({ ...start, offerId: foreignOfferId })]],
    { success: false, error: 'offer_not_found' },
    'one-call',
  );
}
await assertRefused(
  world,
  [['startOfferRevision bad offer id', () => startOfferRevision({ ...start, offerId: 'not-a-uuid' })]],
  { success: false, error: 'invalid_input' },
  'none',
);
world.rpcCalls.length = 0;
revalidated.length = 0;
assert.deepEqual(await startOfferRevision(start), {
  success: true,
  offerId: ownOfferId,
  revision: 2,
  version: 3,
  updatedAt: '2026-11-27T08:00:00.123456+00:00',
});
assert.deepEqual(
  world.rpcCalls.map((call) => [
    call.name,
    call.args.p_organization_id,
    call.args.p_actor_id,
    call.args.p_offer_id,
    call.args.p_expected_version,
  ]),
  [['start_offer_revision', ORGANIZATION_A, CALLER_ID, ownOfferId, 2]],
);
assert.deepEqual(revalidated, [`/angebote/${ownOfferId}`]);

// A refusal for another session's newer save renders the offer's page into its
// answer, so the editor can offer that content at once.
world.rpc = () => ({ data: null, error: { code: 'P0001', message: 'offer_changed' } });
revalidated.length = 0;
assert.deepEqual(await saveOfferContent(content), { success: false, error: 'offer_changed' });
assert.deepEqual(revalidated, [`/angebote/${ownOfferId}`]);

// The pages read only the caller's organization; another organization's offer reads as none.
world.rpc = ({ name }) =>
  name === 'list_offer_page'
    ? { data: { total: 0, hasAny: false, rows: [] }, error: null }
    : { data: name === 'get_offer_with_revisions' ? { offer: null, revisions: [] } : null, error: null };
world.rpcCalls.length = 0;
await renderTree(() => OffersPage({ searchParams: Promise.resolve({}) }));
await renderTree(() => OfferPage({ params: Promise.resolve({ offerId: foreignOfferId }) }));
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [
    ['list_offer_page', ORGANIZATION_A],
    ['get_offer_with_revisions', ORGANIZATION_A],
  ],
);

// A site may lack address parts (client_sites.street, postal_code and city allow null):
// its offer still reads, and the header names what the site has.
const { readOfferWithRevisions } = await import('@/lib/offers/reads');
/** get_offer_with_revisions's answer: the offer as get_offer_with_costs answers it, and no sent revision. */
const pageOf = (offer: unknown) => ({ offer, revisions: [] });
world.rpc = ({ name }) =>
  name === 'get_offer_with_revisions'
    ? {
        data: pageOf({
          costs: [],
          priceSources: [],
          offer: {
            id: ownOfferId,
            offerNumber: 'ANG-2026-1',
            title: 'Heizungstausch',
            status: 'entwurf',
            version: 1,
            contentVersion: 1,
            validUntil: '2026-12-14',
            openingText: '',
            closingText: '',
            client: { id: ownClientId, name: 'Haustechnik Sonnenberg GmbH' },
            site: { id: ownClientId, name: 'Lindenhof 3', street: null, postalCode: '12345', city: null },
            contact: null,
            recipient: {
              id: ownClientId,
              name: 'Haustechnik Sonnenberg GmbH',
              address: null,
              isDefault: true,
            },
            owner: null,
            work: null,
            sections: [],
          },
        }),
        error: null,
      }
    : { data: null, error: null };
const sparse = (await readOfferWithRevisions(ORGANIZATION_A, ownOfferId))?.offer;
assert.equal(sparse?.site?.address, '12345');

// A stored cost above what the editor takes (any article price may stand there) still loads, a
// Position saved before price sources were kept reads as „manuell“, and one without a type as normal.
world.rpc = ({ name }) =>
  name === 'get_offer_with_revisions'
    ? {
        data: pageOf({
          costs: [[{ amountCents: 250_000_000, priceQuantity: 1000 }]],
          priceSources: [[null]],
          offer: {
            ...sparse,
            site: null,
            owner: null,
            work: null,
            sections: [
              {
                title: 'Material',
                positions: [
                  {
                    kind: 'free',
                    name: 'Pressfitting 15 mm',
                    description: '',
                    quantity: '1000',
                    unit: 'piece',
                    unitPriceCents: 99_000_000,
                    priceQuantity: 1000,
                    taxRateBasisPoints: 1900,
                    source: null,
                  },
                ],
              },
            ],
          },
        }),
        error: null,
      }
    : { data: null, error: null };
const costly = (await readOfferWithRevisions(ORGANIZATION_A, ownOfferId))?.offer;
assert.deepEqual(
  costly?.sections[0]?.positions[0],
  {
    kind: 'free',
    name: 'Pressfitting 15 mm',
    description: '',
    positionType: { kind: 'normal' },
    quantity: '1000',
    unit: 'piece',
    unitPriceCents: 99_000_000,
    priceQuantity: 1000,
    taxRateBasisPoints: 1900,
    source: null,
    cost: { amountCents: 250_000_000, priceQuantity: 1000 },
    priceSource: { kind: 'manuell' },
  },
  'a stored cost above the editor limit did not load',
);
