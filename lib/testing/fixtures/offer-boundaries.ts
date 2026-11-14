// The real offer action and pages over the in-memory database: a field
// worker is refused before any database access, another organization's
// customer is refused by the one database function the action calls, the
// office's write carries its own organization and actor, and the pages read
// only the caller's organization.
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

const { createOffer } = await import('@/lib/offers/actions');
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
