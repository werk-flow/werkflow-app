import { existsSync, readFileSync, statSync } from 'node:fs';

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { shouldRefreshStoredSession } from '../../../lib/testing/run-policy';
import {
  storageStatePath,
  type TestRole,
  type TestUser,
  type TestWorld,
} from './world';

export type SessionRole = TestRole | 'outsider';

function roleUser(world: TestWorld, role: SessionRole): TestUser {
  return role === 'outsider' ? world.outsider.admin : world.users[role];
}

function roleOrganizationId(world: TestWorld, role: SessionRole): string {
  return role === 'outsider' ? world.outsider.orgId : world.orgId;
}

function storageStateHasOrganization(path: string, organizationId: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8')) as {
      cookies?: Array<{ name?: string; value?: string }>;
    };
    const cookies = state.cookies ?? [];
    const organizationMatches = cookies.some(
      (cookie) => cookie.name === 'current_org_id' && cookie.value === organizationId
    );
    const hasAuthSession = cookies.some((cookie) =>
      /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name ?? '')
    );
    return organizationMatches && hasAuthSession;
  } catch {
    return false;
  }
}

export async function loginAndSaveRoleSession(input: {
  browser: Browser;
  baseUrl: string;
  user: TestUser;
  organizationId: string;
  statePath: string;
}): Promise<void> {
  const context = await input.browser.newContext({ locale: 'de-DE' });
  try {
    const page = await context.newPage();
    let loggedIn = false;
    for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
      await page.goto(`${input.baseUrl}/login`);
      await page.waitForLoadState('networkidle');
      // The preceding attempt can authenticate just after its navigation wait
      // expires. Reuse that valid late result instead of looking for a login
      // form on the authenticated redirect.
      if (!new URL(page.url()).pathname.startsWith('/login')) {
        loggedIn = true;
        break;
      }
      await page.locator('input[autocomplete="email"]').fill(input.user.email);
      await page.locator('input[autocomplete="current-password"]').fill(input.user.password);
      await page.getByRole('button', { name: 'Anmelden' }).click();
      loggedIn = await page
        .waitForURL('**/dashboard', { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!loggedIn) throw new Error(`Login did not reach the dashboard for ${input.user.email}`);

    let organizationSelected = false;
    for (let attempt = 1; attempt <= 3 && !organizationSelected; attempt++) {
      organizationSelected = await expect
        .poll(
          async () =>
            (await context.cookies()).find((cookie) => cookie.name === 'current_org_id')?.value,
          { timeout: 20_000 }
        )
        .toBe(input.organizationId)
        .then(() => true)
        .catch(() => false);
      if (!organizationSelected) await page.reload({ waitUntil: 'networkidle' });
    }
    if (!organizationSelected) {
      throw new Error(`Dashboard did not select the expected organization for ${input.user.email}`);
    }
    await context.storageState({ path: input.statePath });
  } finally {
    await context.close();
  }
}

export async function verifyStoredRoleSession(input: {
  browser: Browser;
  baseUrl: string;
  organizationId: string;
  statePath: string;
}): Promise<void> {
  const context = await input.browser.newContext({ storageState: input.statePath, locale: 'de-DE' });
  try {
    const page = await context.newPage();
    await page.goto(`${input.baseUrl}/auftraege`);
    await page.waitForLoadState('domcontentloaded');
    if (new URL(page.url()).pathname === '/login') {
      throw new Error(`Saved session redirected to login: ${input.statePath}`);
    }
    await expect
      .poll(
        async () =>
          (await context.cookies()).find((cookie) => cookie.name === 'current_org_id')?.value,
        { timeout: 20_000 }
      )
      .toBe(input.organizationId);
    // Protected-route middleware may rotate the Supabase refresh token. Save
    // that verified state so the next fixture does not reopen the pre-rotation
    // token and get redirected to login.
    await context.storageState({ path: input.statePath });
  } finally {
    await context.close();
  }
}

export async function ensureFreshRoleSession(input: {
  browser: Browser;
  baseUrl: string;
  world: TestWorld;
  role: SessionRole;
  force?: boolean;
}): Promise<void> {
  const path = storageStatePath(input.role);
  const organizationId = roleOrganizationId(input.world, input.role);
  const savedAt = existsSync(path) ? statSync(path).mtimeMs : 0;
  const organizationMatches = storageStateHasOrganization(path, organizationId);
  if (
    !input.force &&
    !shouldRefreshStoredSession(savedAt, Date.now(), organizationMatches)
  ) {
    return;
  }
  await loginAndSaveRoleSession({
    browser: input.browser,
    baseUrl: input.baseUrl,
    user: roleUser(input.world, input.role),
    organizationId,
    statePath: path,
  });
  await verifyStoredRoleSession({
    browser: input.browser,
    baseUrl: input.baseUrl,
    organizationId,
    statePath: path,
  });
}

export async function createRolePage(input: {
  browser: Browser;
  baseUrl: string;
  world: TestWorld;
  role: SessionRole;
}): Promise<{ context: BrowserContext; page: Page }> {
  await ensureFreshRoleSession(input);
  const context = await input.browser.newContext({
    storageState: storageStatePath(input.role),
    locale: 'de-DE',
  });
  try {
    return { context, page: await context.newPage() };
  } catch (error) {
    await context.close();
    throw error;
  }
}
