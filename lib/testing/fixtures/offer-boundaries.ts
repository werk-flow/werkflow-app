// The real offer actions and pages over the in-memory database: a field
// worker is refused before any database access, another organization's
// customer, offer or recipient is refused by the one database function the
// action calls, the office's writes carry their own organization and actor,
// and the pages read only the caller's organization.
// supabase/tests/offers.sql proves the function's refusals, grants and history.
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
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const { createOffer, updateOffer } = await import('@/lib/offers/actions');
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

// The pages read only the caller's organization.
world.rpc = ({ name }) =>
  name === 'list_offer_page'
    ? { data: { total: 0, hasAny: false, rows: [] }, error: null }
    : { data: null, error: null };
world.rpcCalls.length = 0;
await renderTree(() => OffersPage({ searchParams: Promise.resolve({}) }));
await renderTree(() => OfferPage({ params: Promise.resolve({ offerId: foreignOfferId }) }));
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [
    ['list_offer_page', ORGANIZATION_A],
    ['get_offer', ORGANIZATION_A],
  ],
);

// A site may lack address parts (client_sites.street, postal_code and city allow null):
// its offer still reads, and the header names what the site has.
const { readOffer } = await import('@/lib/offers/reads');
world.rpc = ({ name }) =>
  name === 'get_offer'
    ? {
        data: {
          id: ownOfferId,
          offerNumber: 'ANG-2026-1',
          title: 'Heizungstausch',
          status: 'entwurf',
          version: 1,
          validUntil: '2026-12-14',
          openingText: '',
          closingText: '',
          client: { id: ownClientId, name: 'Haustechnik Sonnenberg GmbH' },
          site: { id: ownClientId, name: 'Lindenhof 3', street: null, postalCode: '12345', city: null },
          contact: null,
          recipient: { id: ownClientId, name: 'Haustechnik Sonnenberg GmbH', address: null, isDefault: true },
          owner: null,
          work: null,
        },
        error: null,
      }
    : { data: null, error: null };
const sparse = await readOffer(ORGANIZATION_A, ownOfferId);
assert.equal(sparse?.site?.address, '12345');
