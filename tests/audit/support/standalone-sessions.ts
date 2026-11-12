import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type {
  StandaloneScreen,
  StandaloneSession,
} from '../../../lib/testing/selection/standalone-route-inventory';
import { TEST_SUPPORT_USER } from '../../../lib/testing/support-user';
import { seedProblemReport, seedTriagedProblemReport } from '../../golden/support/db/problem-reports';
import { createAdminClient } from '../../golden/support/db/shared';
import { signInSupportUser } from '../../golden/support/support-session';
import { goldenTestEmail } from '../../golden/support/seed';
import { settled } from '../../golden/support/steps/interaction';
import { openPage } from '../../golden/support/streamed-content';
import { simulatedPaymentButton, signUpViaUi } from '../../golden/support/steps/organization';
import type { TestWorld } from '../../golden/support/world';

// The sessions of the screens outside the app shell
// (lib/testing/selection/standalone-route-inventory.ts). Each screen opens in
// its own browser context: an anonymous visitor, an account the real signup
// page created, or the synthetic support user. The prestart member joins the outsider organization,
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
  baseURL: string | undefined,
): Promise<string | null> {
  if (session === 'anonymous') return null;
  if (session === 'support') {
    if (!baseURL) throw new Error('The support session needs a base URL for its cookies');
    await signInSupportUser(page.context(), baseURL);
    await seedSupportReports(world);
    return TEST_SUPPORT_USER.email;
  }
  const { email } = await signUpNewcomer(page, world);
  if (session === 'subscriber') {
    await page.goto('/upgrade');
    await simulatedPaymentButton(page).click();
    await expect(page).toHaveURL(/\/onboarding\/create-organization/);
  }
  if (session === 'prestart') await makePrestartMember(world, email);
  return email;
}

/** The report of support's screens: sent by the world's employee at a fixed time, its scrubbed copy pending, without history. */
const SUPPORT_REPORT = {
  description: 'Bei Familie Beispiel in der Musterstraße 1 speichert der Auftrag nicht.',
  createdAt: '2026-11-02T08:15:00.000Z',
} as const;

/** A second report, already in work, so the queue shows a triaged row beside the new one. */
const SUPPORT_REPORT_IN_WORK = {
  description: 'Die Zeiterfassung startet nicht, der Knopf bleibt grau.',
  createdAt: '2026-11-03T10:40:00.000Z',
} as const;

/** The reports of support's screens in the world's organization; returns the new, untriaged one. */
async function seedSupportReports(world: TestWorld): Promise<string> {
  const report = { orgId: world.orgId, reporterId: world.users.employee.id };
  const reportId = await seedProblemReport({ ...report, ...SUPPORT_REPORT });
  await seedTriagedProblemReport({ ...report, ...SUPPORT_REPORT_IN_WORK });
  return reportId;
}

/** The screen's address with its `[reportId]` segment replaced by the world's new report. */
async function resolvePath(world: TestWorld, path: string): Promise<string> {
  if (!path.includes('[reportId]')) return path;
  return path.replace('[reportId]', await seedSupportReports(world));
}

/**
 * Opens a standalone screen in a new context with the session it needs and
 * returns the account's address (null when anonymous) and the address it
 * opened; the caller closes the context.
 */
export async function openStandaloneScreen(input: {
  browser: Browser;
  baseURL: string | undefined;
  world: TestWorld;
  screen: StandaloneScreen;
}): Promise<{ context: BrowserContext; page: Page; email: string | null; path: string }> {
  const context = await input.browser.newContext({
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  try {
    const page = await openPage(context);
    const email = await prepareSession(page, input.world, input.screen.session, input.baseURL);
    const path = await resolvePath(input.world, input.screen.path);
    if (input.screen.cookie) {
      if (!input.baseURL) throw new Error(`${input.screen.route} needs a base URL for its cookie`);
      const url = new URL(input.screen.path, input.baseURL).href;
      await context.addCookies([{ ...input.screen.cookie, url }]);
    }
    await page.goto(path);
    const pathname = path.split('?')[0] ?? path;
    await expect(page, `${input.screen.route} opens without a redirect`).toHaveURL(
      (url) => url.pathname === pathname,
    );
    await expect(page.getByRole('main')).toBeVisible();
    await settled(page);
    return { context, page, email, path };
  } catch (error) {
    // The caller only receives a context that opened; a failed setup closes its own.
    await context.close();
    throw error;
  }
}
