import { resolve } from 'node:path';

import { expect, test } from '../golden/support/fixtures';
import {
  getDocumentStoragePathByName,
  getPendingInviteCode,
  getTimeCaptureState,
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
  textInDom,
} from '../golden/support/steps';
import { createSignedDownloadUrl } from '../../lib/storage/r2';
import { goldenTestEmail } from '../golden/support/seed';
import { ARTIFACTS_DIR } from '../golden/support/world';
import { expectLiveWithin } from '../golden/support/live';
import { getDevMigrationHistoryProblems } from '../../lib/testing/dev-migration-history';

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
      for (const route of [
        '/auftraege',
        '/kalender',
        '/kunden',
        '/dashboard',
      ]) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(new URL(page.url()).pathname).toBe(route);
      }
      await expect
        .poll(
          async () =>
            (await context.cookies()).find(
              (cookie) => cookie.name === 'current_org_id',
            )?.value,
        )
        .toBe(world.orgId);
    } finally {
      await context.close();
    }
  });

  test('C2: Direkter R2-Upload und Download-Roundtrip', async ({
    adminPage,
    world,
  }) => {
    await createJob(adminPage, {
      jobNumber: `CAN-${world.runId}-1`,
      title: `Canary Auftrag ${world.runId}`,
      assignEmployeeName: 'Emil',
    });
    await uploadDocumentOnJobPage(
      adminPage,
      `CAN-${world.runId}-1`,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture',
    );
    // The browser PUT went straight to R2; prove the bytes are really there by
    // fetching them back over a signed download URL.
    const storagePath = await getDocumentStoragePathByName(
      world.orgId,
      'upload-fixture',
    );
    const downloadUrl = await createSignedDownloadUrl({ path: storagePath });
    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(60_000),
    });
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
    await expect(
      textInDom(bueroPage, `Canary Realtime ${world.runId}`),
    ).toHaveCount(0);
    await createCustomer(adminPage, `Canary Realtime ${world.runId}`);
    // No reload: the row must arrive through the Realtime subscription within
    // the cloud latency budget (D4); the measured time lands in the archive.
    await expectLiveWithin(
      visibleText(bueroPage, `Canary Realtime ${world.runId}`),
      {
        label: 'canary C3 realtime cross-session',
      },
    );
  });

  test('C4: Einladung mit echter Resend-E-Mail und Beitritt', async ({
    adminPage,
    browser,
    world,
  }) => {
    // The success flash requires the edge function's real Resend call to
    // return 2xx — a failed send rolls the invite back and fails here.
    await inviteMember(adminPage, world.invitee.email, 'Handwerker/in');
    const inviteCode = await getPendingInviteCode(
      world.orgId,
      world.invitee.email,
    );
    const context = await browser.newContext({ locale: 'de-DE' });
    try {
      const page = await context.newPage();
      await joinOrganizationViaInviteLink(
        page,
        inviteCode,
        { email: world.invitee.email, password: world.invitee.password },
        world.orgId,
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
    await expect(
      textInDom(outsiderPage, `Canary Realtime ${world.runId}`),
    ).toHaveCount(0);
    await outsiderPage.goto('/auftraege');
    await expect(textInDom(outsiderPage, `CAN-${world.runId}-1`)).toHaveCount(
      0,
    );
  });

  test('C6: Ein- und Ausstempeln mit persistierter kanonischer Sitzung', async ({
    employeePage,
    world,
  }) => {
    const before = await getTimeCaptureState(
      world.orgId,
      world.users.employee.id,
    );
    const previousSessionIds = new Set(
      before.sessions.map((session) => session.id),
    );
    const previousSegmentIds = new Set(
      before.segments.map((segment) => segment.id),
    );
    await clockInOnJob(employeePage);
    await clockOut(employeePage);
    const after = await getTimeCaptureState(
      world.orgId,
      world.users.employee.id,
    );
    const newSessions = after.sessions.filter(
      (session) => !previousSessionIds.has(session.id),
    );
    const newSegments = after.segments.filter(
      (segment) => !previousSegmentIds.has(segment.id),
    );
    expect(newSessions).toHaveLength(1);
    expect(newSessions[0]).toMatchObject({ status: 'closed' });
    expect(newSessions[0]?.ended_at).not.toBeNull();
    expect(newSegments).toHaveLength(1);
    expect(newSegments[0]).toMatchObject({
      kind: 'work',
      allocation_kind: 'unallocated',
    });
    expect(newSegments[0]?.job_id).toBeNull();
    expect(newSegments[0]?.ended_at).not.toBeNull();
    expect(after.legacyEntries).toHaveLength(before.legacyEntries.length);
  });

  test('C7: Server-Action-Schreibvorgang mit persistiertem Read-back', async ({
    adminPage,
    world,
  }) => {
    await createCustomer(adminPage, `Canary Kunde ${world.runId}`);
    // Fresh navigation: the row must come from server-rendered persisted
    // state, not the optimistic echo (testing rule 13).
    await adminPage.goto('/kunden');
    await expect(
      visibleText(adminPage, `Canary Kunde ${world.runId}`),
    ).toBeVisible();
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
      await page
        .getByLabel('E-Mail')
        .fill(goldenTestEmail('gg-hibp', world.runId));
      // Meets every client-side rule (length, cases, digit) but is one of the
      // most common breached passwords — only HaveIBeenPwned rejects it.
      await page
        .getByRole('textbox', { name: 'Passwort', exact: true })
        .fill('Password123');
      await page.getByRole('button', { name: 'Registrieren' }).click();
      await expect(
        visibleText(
          page,
          'Dieses Passwort ist aus Datenlecks bekannt und daher unsicher. Bitte wähle ein anderes Passwort.',
        ),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test('C9: DEV-Migrationshistorie entspricht den committeten Dateien', async () => {
    expect(await getDevMigrationHistoryProblems()).toEqual([]);
  });
});
