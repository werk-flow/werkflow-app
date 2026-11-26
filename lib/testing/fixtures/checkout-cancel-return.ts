// A cancelled Checkout returns where it started (werk-flow/werkflow-planning#500).
// The real return page and /upgrade over the in-memory database: a payer
// without an organization goes back to /upgrade, which offers the first
// organization's Checkout; an Admin who cancelled a further organization's
// Checkout is offered that Checkout again and never the active organization's
// own subscription, even while that organization has none. The page reads
// only the caller's own records; a paid reservation goes on to naming it.
import assert from 'node:assert/strict';
import { createElement, isValidElement, type ReactElement } from 'react';
import { CALLER_ID, ORGANIZATION_A, signInAs, tableRows } from './action-boundary-world';
import { installPageWorld, refusal, renderTree } from './page-render';

const RESERVED = '20000000-0000-4000-8000-0000000000ee';
const world = await installPageWorld({
  organizations: [{ id: ORGANIZATION_A, admin_id: CALLER_ID, name: 'Haustechnik Sonnenberg GmbH' }],
  organization_members: [],
  werkflow_subscriptions: [],
});

const { default: CheckoutCancelledPage } = await import('@/app/upgrade/abgebrochen/page');
const { default: UpgradePage } = await import('@/app/upgrade/page');

const cancelled = () => createElement(CheckoutCancelledPage);
const upgrade = () => createElement(UpgradePage);

/** The client components a page renders, by name, with their props. */
async function offers(page: () => ReactElement): Promise<Array<{ name: string; props: unknown }>> {
  const elements = await renderTree(page);
  return elements.flatMap((element) =>
    isValidElement(element) && typeof element.type === 'function'
      ? [{ name: element.type.name, props: element.props }]
      : [],
  );
}

const setMembership = (role: 'admin' | 'buero' | 'employee' | null) => {
  signInAs(world, role);
  world.tables.organization_members =
    role === null ? [] : [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role }];
};
const reserve = (paid: boolean) => {
  world.tables.werkflow_subscriptions = [
    {
      organization_id: RESERVED,
      reserved_by: CALLER_ID,
      linked_at: null,
      stripe_customer_id: 'cus_test_reserved',
      stripe_subscription_id: paid ? 'sub_test_reserved' : null,
      holds_subscription: paid,
      runs_subscription: paid,
      checkout_session_id: 'cs_test_reserved',
    },
  ];
};

// A signed-out visitor signs in first.
world.callerId = null;
assert.equal(await refusal(cancelled), 'redirect:/login');

// --- /upgrade before any organization: the cancel returns to /upgrade, which offers the first organization. ---
setMembership(null);
reserve(false);
assert.equal(await refusal(cancelled), 'redirect:/upgrade');
const firstOffer = (await offers(upgrade)).find((offer) => offer.name === 'SubscribeButton');
assert.ok(firstOffer, '/upgrade offered no Checkout to a payer without an organization');
assert.deepEqual(firstOffer.props, {}, "/upgrade offered an organization's own subscription to a newcomer");

// --- A further organization: the cancel offers that Checkout again, never the active organization's. ---
// The active organization has no subscription, so /upgrade itself would offer it.
setMembership('admin');
reserve(false);
assert.deepEqual(
  (await offers(upgrade)).find((offer) => offer.name === 'SubscribeButton')?.props,
  { organizationId: ORGANIZATION_A },
  "the precondition failed: /upgrade offers the active organization's subscription",
);
const furtherOffers = await offers(cancelled);
assert.deepEqual(
  furtherOffers.find((offer) => offer.name === 'FurtherOrganizationCheckoutButton')?.props,
  { adminOrganizationId: ORGANIZATION_A },
  "a cancelled further organization's Checkout was not offered again",
);
assert.equal(
  furtherOffers.some((offer) => offer.name === 'SubscribeButton'),
  false,
  "the return offered the active organization's subscription",
);

// Paid meanwhile: the Admin names the further organization.
reserve(true);
assert.equal(await refusal(cancelled), 'redirect:/onboarding/create-organization');

// Without an open reservation, or without an organization to pay from, nothing was cancelled here.
world.tables.werkflow_subscriptions = [];
assert.equal(await refusal(cancelled), 'redirect:/dashboard');
for (const role of ['buero', 'employee'] as const) {
  setMembership(role);
  reserve(false);
  assert.equal(await refusal(cancelled), 'redirect:/dashboard', role);
}
assert.ok(tableRows(world, 'werkflow_subscriptions').length === 1, 'the return page changed a reservation');
