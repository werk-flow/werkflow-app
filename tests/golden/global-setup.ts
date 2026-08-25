import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, type FullConfig } from '@playwright/test';

import { loadEnvLocal } from './support/env';
import { createTestWorld, destroyLeftoverTestWorlds } from './support/seed';
import {
  ARTIFACTS_DIR,
  saveWorld,
  storageStatePath,
  type TestWorld,
} from './support/world';

async function loginAndSaveState(
  baseURL: string,
  email: string,
  password: string,
  expectedOrgId: string,
  statePath: string
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();

    // Clicking before React hydration attaches the submit handler falls back
    // to a native form submission that reloads /login; retry when that happens.
    let loggedIn = false;
    for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
      await page.goto(`${baseURL}/login`);
      await page.waitForLoadState('networkidle');
      await page.locator('input[autocomplete="email"]').fill(email);
      await page.locator('input[autocomplete="current-password"]').fill(password);
      await page.getByRole('button', { name: 'Anmelden' }).click();
      loggedIn = await page
        .waitForURL('**/dashboard', { timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!loggedIn) {
      throw new Error(`Login did not reach the dashboard for ${email}`);
    }

    let organizationSelected = false;
    for (let attempt = 1; attempt <= 3 && !organizationSelected; attempt++) {
      organizationSelected = await expect
        .poll(
          async () =>
            (await context.cookies()).find((cookie) => cookie.name === 'current_org_id')?.value,
          { timeout: 20_000 }
        )
        .toBe(expectedOrgId)
        .then(() => true)
        .catch(() => false);
      if (!organizationSelected) {
        await page.reload({ waitUntil: 'networkidle' });
      }
    }
    if (!organizationSelected) {
      throw new Error(`Dashboard did not select the expected organization for ${email}`);
    }
    await context.storageState({ path: statePath });
    await context.close();
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  loadEnvLocal();
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';

  // Clean up any worlds a crashed previous run left behind.
  const removed = await destroyLeftoverTestWorlds();
  if (removed > 0) {
    console.log(`[golden] removed ${removed} leftover test records from earlier runs`);
  }

  const world: TestWorld = await createTestWorld();
  saveWorld(world);
  console.log(`[golden] seeded world ${world.runId} (org ${world.orgId})`);

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  // A 6 MB upload fixture proves the old 4.5 MB Vercel body limit is gone.
  const largePdfPath = resolve(ARTIFACTS_DIR, 'upload-fixture.pdf');
  const sixMegabytes = 6 * 1024 * 1024;
  const buffer = Buffer.alloc(sixMegabytes, 'WerkFlow golden gate upload fixture. ');
  buffer.write('%PDF-1.4\n', 0);
  writeFileSync(largePdfPath, buffer);

  await loginAndSaveState(
    baseURL,
    world.users.admin.email,
    world.users.admin.password,
    world.orgId,
    storageStatePath('admin')
  );
  await loginAndSaveState(
    baseURL,
    world.users.buero.email,
    world.users.buero.password,
    world.orgId,
    storageStatePath('buero')
  );
  await loginAndSaveState(
    baseURL,
    world.users.employee.email,
    world.users.employee.password,
    world.orgId,
    storageStatePath('employee')
  );
  await loginAndSaveState(
    baseURL,
    world.outsider.admin.email,
    world.outsider.admin.password,
    world.outsider.orgId,
    storageStatePath('outsider')
  );

  console.log('[golden] all four role sessions saved');
}
