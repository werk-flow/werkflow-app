import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type {
  StandaloneScreen,
  StandaloneSession,
} from '../../../lib/testing/selection/standalone-route-inventory';
import { createAdminClient } from '../../golden/support/db/shared';
import { goldenTestEmail } from '../../golden/support/seed';
import { settled } from '../../golden/support/steps/interaction';
import { simulatedPaymentButton, signUpViaUi } from '../../golden/support/steps/organization';
import type { TestWorld } from '../../golden/support/world';

// The sessions of the screens outside the app shell
// (lib/testing/selection/standalone-route-inventory.ts). Each screen opens in
// its own browser context: an anonymous visitor, or an account the real
// signup page created. The prestart member joins the outsider organization,
// so the audit world's own organization keeps its people.

/** The constant name of every account the standalone sessions create. */
const STANDALONE_ACCOUNT = { firstName: 'Lena', lastName: 'Neumann' } as const;

/** A future start, so the membership stays in its prestart state for the run. */
const PRESTART_FOR = '2099-01-01T06:00:00.000Z';

let accountCount = 0;

async function signUpNewcomer(page: Page, world: TestWorld): Promise<{ email: string }> {
  // The counter restarts with a new worker after a failed test; the test id's hash keeps the address unique.
  accountCount += 1;
  const testHash = test.info().testId.slice(-8);
  const email = goldenTestEmail(`standalone-${testHash}-${accountCount}`, world.runId);
  await signUpViaUi(page, {
    ...STANDALONE_ACCOUNT,
    email,
    password: `Standalone!${world.runId}2026`,
  });
  return { email };
}

async function userIdOf(email: string): Promise<string> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()
    .throwOnError();
  return data.id;
}

/** Adds the account to the outsider organization with an access that starts later. */
async function makePrestartMember(world: TestWorld, email: string): Promise<void> {
  const admin = createAdminClient();
  const userId = await userIdOf(email);
  await admin
    .from('organization_members')
    .insert({ organization_id: world.outsider.orgId, user_id: userId, role: 'employee' })
    .throwOnError();
  const { data: record } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', world.outsider.orgId)
    .eq('user_id', userId)
    .single()
    .throwOnError();
  await admin
    .from('personnel_access_lifecycles')
    .insert({
      organization_id: world.outsider.orgId,
      employee_record_id: record.id,
      state: 'scheduled',
      scheduled_state: 'active',
      scheduled_for: PRESTART_FOR,
      state_effective_at: new Date().toISOString(),
      created_by: world.outsider.admin.id,
    })
    .throwOnError();
}

/** Signs the session's account up where it needs one; returns its address, or null for an anonymous visitor. */
async function prepareSession(
  page: Page,
  world: TestWorld,
  session: StandaloneSession,
): Promise<string | null> {
  if (session === 'anonymous') return null;
  const { email } = await signUpNewcomer(page, world);
  if (session === 'subscriber') {
    await page.goto('/upgrade');
    await simulatedPaymentButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/create-organization/);
  }
  if (session === 'prestart') await makePrestartMember(world, email);
  return email;
}

/**
 * Opens a standalone screen in a new context with the session it needs and
 * returns the account's address (null when anonymous); the caller closes the context.
 */
export async function openStandaloneScreen(input: {
  browser: Browser;
  baseURL: string | undefined;
  world: TestWorld;
  screen: StandaloneScreen;
}): Promise<{ context: BrowserContext; page: Page; email: string | null }> {
  const context = await input.browser.newContext({
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  try {
    const page = await context.newPage();
    const email = await prepareSession(page, input.world, input.screen.session);
    if (input.screen.cookie) {
      if (!input.baseURL) throw new Error(`${input.screen.route} needs a base URL for its cookie`);
      const url = new URL(input.screen.path, input.baseURL).href;
      await context.addCookies([{ ...input.screen.cookie, url }]);
    }
    await page.goto(input.screen.path);
    const pathname = input.screen.path.split('?')[0] ?? input.screen.path;
    await expect(page, `${input.screen.route} opens without a redirect`).toHaveURL(
      (url) => url.pathname === pathname,
    );
    await expect(page.getByRole('main')).toBeVisible();
    await settled(page);
    return { context, page, email };
  } catch (error) {
    // The caller only receives a context that opened; a failed setup closes its own.
    await context.close();
    throw error;
  }
}
