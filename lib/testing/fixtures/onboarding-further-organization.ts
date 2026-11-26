// After paying for a further organization (werk-flow/werkflow-planning#495),
// Stripe's return sends the Admin to /onboarding/create-organization. The real
// onboarding layout and naming page let a member through while their paid
// reservation holds, and send a member without one to the dashboard.
import assert from 'node:assert/strict';
import { createElement, isValidElement } from 'react';
import { CALLER_ID, ORGANIZATION_A, signInAs, tableRows } from './action-boundary-world';
import { installPageWorld, renderTree } from './page-render';

const RESERVED = '20000000-0000-4000-8000-0000000000ee';
const world = await installPageWorld({
  organizations: [{ id: ORGANIZATION_A, admin_id: CALLER_ID, name: 'Haustechnik Sonnenberg GmbH' }],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'admin' }],
  werkflow_subscriptions: [],
});
signInAs(world, 'admin');

const { default: OnboardingLayout } = await import('@/app/onboarding/layout');
const { default: CreateOrganizationPage } = await import('@/app/onboarding/create-organization/page');

/** The onboarding layout around the naming page, as the server renders the route. */
const route = () => renderTree(() => OnboardingLayout({ children: createElement(CreateOrganizationPage) }));

// A member without a paid reservation goes to the dashboard.
await assert.rejects(route(), { message: 'redirect:/dashboard' });

// A member whose further organization is paid names it.
tableRows(world, 'werkflow_subscriptions').push({
  organization_id: RESERVED,
  reserved_by: CALLER_ID,
  linked_at: null,
  stripe_customer_id: 'cus_test_further',
  stripe_subscription_id: 'sub_test_further',
  holds_subscription: true,
  runs_subscription: true,
  checkout_session_id: null,
});
const elements = await route();
assert.ok(
  elements.some(
    (element) =>
      isValidElement(element) &&
      typeof element.type === 'function' &&
      element.type.name === 'CreateOrganizationForm',
  ),
  'a member who paid for a further organization could not name it',
);
