import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '../golden/support/fixtures';
import {
  getDocumentStoragePathByName,
  getOrganizationTimeEntrySnapshot,
  getPendingInviteCode,
} from '../golden/support/db';
import {
  clockInOnJob,
  clockOut,
  createCustomer,
  createJob,
  inviteMember,
  joinOrganizationViaInviteLink,
  loginViaUi,
  uploadDocumentOnJobPage,
  visibleText,
} from '../golden/support/steps';
import { createSignedDownloadUrl } from '../../lib/storage/r2';
import { requireEnv } from '../golden/support/env';
import { ARTIFACTS_DIR } from '../golden/support/world';

// Cloud canary suite (@CANARY) — decision D10 in
// docs/plans/platform-hardening.md, ADR docs/decisions/0006-testing-architecture.md.
//
// Application logic is certified against the local Supabase stack. This suite
// exists for the behavior only the cloud can prove: real provider auth and
// session refresh, R2 byte round trips through signed URLs, Realtime delivery
// through cloud infrastructure, real Resend mail, the HaveIBeenPwned
// leaked-password rejection, and migration-history parity. Keep it short —
// the growth rule lives in docs/technical/testing.md. It only runs with
// target cloud (enforced by run-policy) against DEV Supabase and real R2.

const DEV_PROJECT_REF = 'mbkkzuqjbdvzelqvuzcn';

test.describe.configure({ mode: 'serial' });

test.describe('Cloud-Canary @CANARY', () => {
  test('C1: Login und Session-Refresh über geschützte Navigationen', async ({
    browser,
    world,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    try {
      const page = await context.newPage();
      await loginViaUi(page, {
        email: world.users.admin.email,
        password: world.users.admin.password,
      });
      // Protected-route middleware refreshes/rotates the Supabase session on
      // every navigation; none of them may bounce back to /login.
      for (const route of ['/auftraege', '/kalender', '/kunden', '/dashboard']) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(new URL(page.url()).pathname).toBe(route);
      }
      await expect
        .poll(async () =>
          (await context.cookies()).find((cookie) => cookie.name === 'current_org_id')?.value
        )
        .toBe(world.orgId);
    } finally {
      await context.close();
    }
  });

  test('C2: Direkter R2-Upload und Download-Roundtrip', async ({ adminPage, world }) => {
    await createJob(adminPage, {
      jobNumber: `CAN-${world.runId}-1`,
      title: `Canary Auftrag ${world.runId}`,
      assignEmployeeName: 'Emil',
    });
    await uploadDocumentOnJobPage(
      adminPage,
      `CAN-${world.runId}-1`,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );
    // The browser PUT went straight to R2; prove the bytes are really there by
    // fetching them back over a signed download URL.
    const storagePath = await getDocumentStoragePathByName(world.orgId, 'upload-fixture');
    const downloadUrl = await createSignedDownloadUrl({ path: storagePath });
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBe(6 * 1024 * 1024);
  });

  test('C3: Realtime-Zustellung zwischen Sitzungen über die Cloud', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    await bueroPage.goto('/kunden');
    await expect(bueroPage.getByText(`Canary Realtime ${world.runId}`)).toHaveCount(0);
    await createCustomer(adminPage, `Canary Realtime ${world.runId}`);
    // No reload: the row must arrive through the Realtime subscription within
    // the documented projection envelope.
    await expect(visibleText(bueroPage, `Canary Realtime ${world.runId}`)).toBeVisible({
      timeout: 30_000,
    });
  });

  test('C4: Einladung mit echter Resend-E-Mail und Beitritt', async ({
    adminPage,
    browser,
    world,
  }) => {
    // The success flash requires the edge function's real Resend call to
    // return 2xx — a failed send rolls the invite back and fails here.
    await inviteMember(adminPage, world.invitee.email, 'Handwerker/in');
    const inviteCode = await getPendingInviteCode(world.orgId, world.invitee.email);
    const context = await browser.newContext({ locale: 'de-DE' });
    try {
      const page = await context.newPage();
      await joinOrganizationViaInviteLink(
        page,
        inviteCode,
        { email: world.invitee.email, password: world.invitee.password },
        world.orgId
      );
    } finally {
      await context.close();
    }
  });

  test('C5: Organisationsgrenze hält gegen fremde Sitzung', async ({
    outsiderPage,
    world,
  }) => {
    await outsiderPage.goto('/kunden');
    await expect(outsiderPage.getByText(`Canary Realtime ${world.runId}`)).toHaveCount(0);
    await outsiderPage.goto('/auftraege');
    await expect(outsiderPage.getByText(`CAN-${world.runId}-1`)).toHaveCount(0);
  });

  test('C6: Ein- und Ausstempeln mit persistiertem Eintrag', async ({
    employeePage,
    world,
  }) => {
    const before = (await getOrganizationTimeEntrySnapshot(world.orgId)).length;
    await clockInOnJob(employeePage, `Canary Auftrag ${world.runId}`);
    await clockOut(employeePage);
    const entries = await getOrganizationTimeEntrySnapshot(world.orgId);
    const newEntries = entries.slice(before);
    expect(newEntries.some((entry) => entry.entry_type === 'clock_in')).toBe(true);
    expect(newEntries.some((entry) => entry.entry_type === 'clock_out')).toBe(true);
  });

  test('C7: Server-Action-Schreibvorgang mit persistiertem Read-back', async ({
    adminPage,
    world,
  }) => {
    await createCustomer(adminPage, `Canary Kunde ${world.runId}`);
    // Fresh navigation: the row must come from server-rendered persisted
    // state, not the optimistic echo (testing rule 13).
    await adminPage.goto('/kunden');
    await expect(visibleText(adminPage, `Canary Kunde ${world.runId}`)).toBeVisible();
  });

  test('C8: HIBP-Ablehnung kompromittierter Passwörter mit deutscher Meldung', async ({
    browser,
    world,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    try {
      const page = await context.newPage();
      await page.goto('/signup');
      await page.waitForLoadState('networkidle');
      await page.getByLabel('Vorname').fill('Canary');
      await page.getByLabel('Nachname').fill(`Hibp-${world.runId}`);
      await page.getByLabel('E-Mail').fill(`gg-hibp-${world.runId}@werkflow-golden.test`);
      // Meets every client-side rule (length, cases, digit) but is one of the
      // most common breached passwords — only HaveIBeenPwned rejects it.
      await page
        .getByRole('textbox', { name: 'Passwort', exact: true })
        .fill('Password123');
      await page.getByRole('button', { name: 'Registrieren' }).click();
      await expect(
        page.getByText(
          'Dieses Passwort ist aus Datenlecks bekannt und daher unsicher. Bitte wähle ein anderes Passwort.'
        )
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test('C9: DEV-Migrationshistorie entspricht den committeten Dateien', async () => {
    const committedVersions = readdirSync(resolve(__dirname, '../../supabase/migrations'))
      .filter((fileName) => fileName.endsWith('.sql'))
      .map((fileName) => fileName.split('_')[0])
      .sort();
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireEnv('SUPABASE_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query:
            'select version from supabase_migrations.schema_migrations order by version',
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );
    expect(response.status).toBe(201);
    const rows = (await response.json()) as Array<{ version: string }>;
    expect(rows.map((row) => row.version).sort()).toEqual(committedVersions);
  });
});
