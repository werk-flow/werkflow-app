'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-result';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { openCheckout, type CheckoutFailureCode } from '@/lib/subscription/checkout';
import { readOpenReservation, userHasOrganizations } from '@/lib/subscription/helpers';
import { uuidSchema } from '@/lib/validation/uuid';

// The monthly subscription starts in Stripe Checkout (werk-flow/werkflow-planning#248).
// A success answers Checkout's URL, which the browser opens; Stripe's signals
// then record the subscription (lib/werkflow-billing/signals/).

export type StartCheckoutResult = ActionResult<
  { checkoutUrl: string },
  'not_authenticated' | 'not_a_member' | 'not_authorized' | 'organization_exists' | CheckoutFailureCode
>;

/**
 * A Checkout for the caller's first organization, before it exists: the
 * subscription reserves the organization's id, and the caller creates the
 * organization after paying. A caller who already paid continues to that step.
 */
export async function startOrganizationCheckout(): Promise<StartCheckoutResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };

  let reservation;
  try {
    if (await userHasOrganizations(user.id)) return { success: false, error: 'organization_exists' };
    reservation = await readOpenReservation(user.id);
  } catch {
    return { success: false, error: 'checkout_failed' };
  }

  const outcome = await openCheckout({
    organizationId: reservation?.organizationId ?? randomUUID(),
    userId: user.id,
    email: user.email ?? null,
    name: null,
    linked: false,
  });
  if (outcome.ok) return { success: true, checkoutUrl: outcome.url };
  if (outcome.code === 'already_subscribed') redirect('/onboarding/create-organization');
  return { success: false, error: outcome.code };
}

/** A Checkout for an existing organization, which only its Admin starts. */
export async function startSubscriptionCheckout(organizationId: string): Promise<StartCheckoutResult> {
  const parsedOrganizationId = uuidSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) return { success: false, error: 'not_a_member' };
  const caller = await resolveActionContextFor(parsedOrganizationId.data);
  if (!caller.success) return caller;
  const { userId, orgId, role } = caller.context;
  if (role !== 'admin') return { success: false, error: 'not_authorized' };

  const user = await getAuthenticatedUser();
  const membership = (await getCachedMemberships(userId)).find((entry) => entry.orgId === orgId);
  const outcome = await openCheckout({
    organizationId: orgId,
    userId,
    email: user?.email ?? null,
    name: membership?.name ?? null,
    linked: true,
  });
  return outcome.ok ? { success: true, checkoutUrl: outcome.url } : { success: false, error: outcome.code };
}
