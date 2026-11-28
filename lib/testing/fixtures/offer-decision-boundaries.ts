// The real decision actions of an offer over the in-memory database: a field
// worker is refused before any database access, another organization's offer
// is refused by the one database function the action calls, a choice that is
// no option of the revision never reaches it, and the office's Annahme
// carries its own organization, actor and the totals the server computed.
// supabase/tests/offer_acceptance.sql proves the functions' refusals, grants and history.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';
import { installPageWorld } from './page-render';

const ownOfferId = '95000000-0000-4000-8000-000000000101';
const foreignOfferId = '95000000-0000-4000-8000-000000000109';

const priced = {
  kind: 'free',
  description: '',
  quantity: '1',
  unit: 'piece',
  unitLabel: 'Stk.',
  priceQuantity: 1,
  taxRateBasisPoints: 1900,
};
// Revision 1 of each offer: 1.1 a boiler, 1.2 a Neutralisationsbox if needed at 7 %.
const content = [
  {
    number: '1',
    title: 'Wärmeerzeuger',
    netCents: 489000,
    positions: [
      { ...priced, number: '1.1', name: 'Gas-Brennwerttherme', unitPriceCents: 489000, amountCents: 489000 },
      {
        ...priced,
        number: '1.2',
        name: 'Neutralisationsbox',
        unitPriceCents: 18500,
        amountCents: 18500,
        taxRateBasisPoints: 700,
        positionType: 'bedarf',
      },
    ],
  },
];
const world = await installPageWorld({
  offer_revisions: [
    { id: crypto.randomUUID(), organization_id: ORGANIZATION_A, offer_id: ownOfferId, revision: 1, content },
    {
      id: crypto.randomUUID(),
      organization_id: ORGANIZATION_B,
      offer_id: foreignOfferId,
      revision: 1,
      content,
    },
  ],
});
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const { acceptOffer, closeOffer, withdrawOfferAcceptance } = await import('@/lib/offers/decision-actions');

const accept = {
  offerId: ownOfferId,
  expectedVersion: 2,
  attemptKey: '96000000-0000-4000-8000-000000000101',
  revision: 1,
  acceptedByName: 'Erika Musterfrau',
  acceptedOn: '2026-11-27',
  channel: 'email' as const,
  note: '',
  chosenOptions: ['1.2'],
};
const reason = {
  offerId: ownOfferId,
  expectedVersion: 3,
  attemptKey: '96000000-0000-4000-8000-000000000102',
  reason: 'Falsche Revision erfasst',
};
const calls = (offerId: string) =>
  [
    ['acceptOffer', () => acceptOffer({ ...accept, offerId })],
    ['withdrawOfferAcceptance', () => withdrawOfferAcceptance({ ...reason, offerId })],
    ['closeOffer', () => closeOffer({ ...reason, offerId, outcome: 'abgelehnt' })],
  ] as const;

// A field worker records no decision and reaches no row.
signInAs(world, 'employee');
await assertRefused(world, calls(ownOfferId), { success: false, error: 'not_authorized' }, 'none');

const decided = { version: 3, updatedAt: '2026-11-28T08:00:00.123456+00:00' };
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  refuseForeignIds(world, new Map([[foreignOfferId, 'offer_not_found']]), decided);
  // Another organization's offer: its revision is not read, and the one call refuses it.
  await assertRefused(world, calls(foreignOfferId), { success: false, error: 'offer_not_found' }, 'one-call');
}

// A bad id, a missing name or reason never reaches the database; a choice that is no option of
// the revision is refused after reading it, before the call.
await assertRefused(
  world,
  [
    ['acceptOffer bad offer id', () => acceptOffer({ ...accept, offerId: 'not-a-uuid' })],
    ['acceptOffer without name', () => acceptOffer({ ...accept, acceptedByName: '  ' })],
    ['closeOffer without reason', () => closeOffer({ ...reason, reason: ' ', outcome: 'zurueckgezogen' })],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);
await assertRefused(
  world,
  [['acceptOffer of a normal Position as option', () => acceptOffer({ ...accept, chosenOptions: ['1.1'] })]],
  { success: false, error: 'invalid_input' },
  'reads',
);

// Büro records the Annahme in its own organization, as itself, with the totals the server
// computed: 4.890,00 € at 19 % and the chosen 185,00 € at 7 %.
world.rpcCalls.length = 0;
assert.deepEqual(await acceptOffer(accept), { success: true, offerId: ownOfferId, ...decided });
assert.deepEqual(
  world.rpcCalls.map((call) => [
    call.name,
    call.args.p_organization_id,
    call.args.p_actor_id,
    call.args.p_chosen_options,
    call.args.p_totals,
  ]),
  [
    [
      'accept_offer',
      ORGANIZATION_A,
      CALLER_ID,
      ['1.2'],
      { netCents: 507500, taxCents: 94205, grossCents: 601705 },
    ],
  ],
);
