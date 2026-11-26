import { randomBytes } from 'node:crypto';

import { expect } from '@playwright/test';

import { newRunId, runOrganizationName } from '../../lib/testing/staging/runs';
import { hydrated } from '../../tests/golden/support/steps/interaction';
import {
  cleanUp,
  createActor,
  failureLine,
  loadKit,
  payWithTestCard,
  readDev,
  readStripe,
  runOrganization,
  signIn,
  withStagingBrowser,
} from './kit';

// `bun run staging:smoke` (.claude/skills/staging-journey/SKILL.md): a new DEV actor signs in on
// staging, pays the subscription in the Stripe sandbox, creates `Agenten-Test <run>` through the
// onboarding and sees its dashboard. The readers check the rows and the sandbox subscription; the
// cleanup deletes the organization and the account through the app, then clears runs older than a day.

const kit = loadKit();
const runId = newRunId(new Date(), randomBytes(3).toString('hex'));
const organizationName = runOrganizationName(runId);
kit.log('run', { run: runId });

/** The journey up to the dashboard; answers the Stripe subscription the cleanup must end. */
async function journey(): Promise<string> {
  const actor = await createActor(kit, runId);
  kit.log('actor created', { actor: actor.id });
  return withStagingBrowser(kit, runId, async (page) => {
    await signIn(page, actor);
    await expect(page).toHaveURL(/\/upgrade|\/onboarding/);
    kit.log('signed in through the bypass');

    await page.goto('/upgrade');
    await hydrated(page);
    await page.getByRole('button', { name: 'Weiter zur Zahlung' }).click();
    await payWithTestCard(page);
    await expect(page).toHaveURL(/\/onboarding\/create-organization/);
    kit.log('paid in the sandbox Checkout');

    await hydrated(page);
    await page.getByLabel('Name der Organisation').fill(organizationName);
    await page.getByRole('button', { name: 'Organisation erstellen' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Organisation erstellt — Du bist jetzt Admin.' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/dashboard/);

    const organization = await runOrganization(kit, actor);
    const [subscription] = await readDev(kit, organization, {
      table: 'werkflow_subscriptions',
      columns: ['status', 'stripe_subscription_id'],
    });
    const subscriptionId = String(subscription?.stripe_subscription_id ?? '');
    if (subscription?.status !== 'active' || !subscriptionId.startsWith('sub_'))
      throw new Error('The organization holds no active subscription on DEV.');
    const [atStripe] = await readStripe(kit, `subscriptions/${subscriptionId}`);
    if (atStripe?.status !== 'active') throw new Error('The sandbox subscription is not active at Stripe.');
    kit.log('dashboard shown', {
      organization: organization.id,
      subscription: subscriptionId,
      dev_status: String(subscription.status),
      stripe_status: String(atStripe?.status),
      livemode: false,
    });
    return subscriptionId;
  });
}

let passed = false;
let subscriptionId: string | null = null;
try {
  subscriptionId = await journey();
  passed = true;
} catch (error) {
  kit.log('smoke failed', { reason: failureLine(kit, error) });
} finally {
  passed = (await cleanUp(kit, runId)) && passed;
  passed = (await cleanUp(kit, null)) && passed;
}
if (subscriptionId) {
  // The deletion ended the subscription at Stripe at once.
  try {
    const [ended] = await readStripe(kit, `subscriptions/${subscriptionId}`);
    kit.log('subscription after cleanup', {
      subscription: subscriptionId,
      stripe_status: String(ended?.status),
    });
    passed &&= ended?.status === 'canceled';
  } catch (error) {
    passed = false;
    kit.log('subscription check failed', { reason: failureLine(kit, error) });
  }
}
kit.log('smoke', { run: runId, result: passed ? 'passed' : 'failed' });
process.exitCode = passed ? 0 : 1;
