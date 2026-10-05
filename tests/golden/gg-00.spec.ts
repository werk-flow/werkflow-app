import { resolve } from 'node:path';

import { expect, test } from './support/fixtures';
import { getInventoryLedgerState } from './support/db/inventory';
import { getPendingInviteCode } from './support/db/shared';
import { seedJob, seedJobAssignment } from './support/db/work';
import { createCustomer } from './support/steps/customers';
import { documentLibraryHeading, uploadDocumentOnJobPage } from './support/steps/documents';
import {
  materialStillOutText,
  returnMaterialOnJobPage,
  takeMaterialOnJobPage,
} from './support/steps/inventory';
import {
  expectRedirectedAway,
  inviteMember,
  joinOrganizationViaInviteLink,
  loginViaUi,
  signOutViaUi,
} from './support/steps/organization';
import { testData, visibleText, textInDom } from './support/steps/shared';
import { clockInOnJob, clockOut } from './support/steps/time-tracking';
import { createJob } from './support/steps/work';
import { artifactsDirectory, type TestWorld } from './support/world';
import { expectLiveWithin, realtimeSubscribed } from './support/live';

// GG-00 — Existing Foundation Regression (@GG-00)
// Verifies the roadmap's baseline scenario: role-scoped core flows, document
// upload via direct-to-R2, organization isolation, and sign-out. Every test
// prepares its own records; only the customer and job journey creates them
// through the dialogs.

/** A job assigned to the employee, prepared through the admin client for a test that claims a later flow. */
async function seedAssignedJob(world: TestWorld, testId: string, title: string): Promise<string> {
  const jobNumber = `GG-${world.runId}-${testId}`;
  const jobId = await seedJob({ orgId: world.orgId, actorId: world.users.admin.id, jobNumber, title });
  await seedJobAssignment({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    jobId,
    userId: world.users.employee.id,
  });
  return jobNumber;
}

test.describe('GG-00 Bestandsfunktionen @GG-00', () => {
  test('Kunde und Aufträge: Mitarbeiter sieht nur Zugewiesenes, fremde Organisation nichts', async ({
    adminPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    const customerName = `Testkunde ${world.runId}`;
    const assignedJob = `GG-${world.runId}-1`;
    const unassignedJob = `GG-${world.runId}-2`;

    await test.step('Admin legt einen Kunden an', async () => {
      await createCustomer(adminPage, customerName);
      await adminPage.goto('/kunden');
      await expect(visibleText(adminPage, customerName)).toBeVisible();
    });

    await test.step('Admin erstellt Aufträge und weist einen Mitarbeiter zu', async () => {
      await createJob(adminPage, {
        jobNumber: assignedJob,
        title: 'Heizung warten (Golden Gate)',
        assignEmployeeName: 'Emil',
      });
      await createJob(adminPage, {
        jobNumber: unassignedJob,
        title: 'Bad sanieren (nicht zugewiesen)',
      });
      await adminPage.goto('/auftraege');
      await expect(visibleText(adminPage, assignedJob)).toBeVisible();
      await expect(visibleText(adminPage, unassignedJob)).toBeVisible();
    });

    await test.step('Mitarbeiter sieht nur zugewiesene Aufträge', async () => {
      await employeePage.goto('/auftraege');
      await expect(visibleText(employeePage, assignedJob)).toBeVisible();
      await expect(textInDom(employeePage, unassignedJob)).toHaveCount(0);
    });

    await test.step('Mobil: Mitarbeiter sieht zugewiesene Aufträge auf kleinem Viewport', async () => {
      await employeePage.setViewportSize({ width: 375, height: 812 });
      await employeePage.goto('/auftraege');
      await expect(visibleText(employeePage, assignedJob)).toBeVisible();
    });

    await test.step('Fremde Organisation sieht keine Daten', async () => {
      await outsiderPage.goto('/kunden');
      await expect(textInDom(outsiderPage, customerName)).toHaveCount(0);
      await outsiderPage.goto('/auftraege');
      await expect(textInDom(outsiderPage, assignedJob)).toHaveCount(0);
    });
  });

  test('Mitarbeiter lädt ein Dokument über 4,5 MB auf den Auftrag hoch, Büro sieht es in der Bibliothek', async ({
    employeePage,
    bueroPage,
    world,
  }) => {
    const jobNumber = await seedAssignedJob(world, 'DOK', `Dokumentauftrag ${world.runId}`);
    const fileName = testData`upload-fixture`;
    await uploadDocumentOnJobPage(
      employeePage,
      jobNumber,
      resolve(artifactsDirectory(), `${fileName}.pdf`),
      fileName,
    );
    await bueroPage.goto('/dokumente');
    await expect(visibleText(bueroPage, fileName)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Mitarbeiter erfasst auftragsbezogene Arbeitszeit', async ({ employeePage, world }) => {
    const jobTitle = `Zeitauftrag ${world.runId}`;
    await seedAssignedJob(world, 'ZEIT', jobTitle);
    await clockInOnJob(employeePage, jobTitle);
    await clockOut(employeePage);
  });

  test('Realtime: Büro sieht neue Kunden ohne Neuladen @FRESHNESS', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // Two users are signed in simultaneously in separate browser contexts.
    await bueroPage.goto('/kunden');
    await expect(realtimeSubscribed(bueroPage)).toBeAttached();

    // The Büro page must pick the new customer up via Realtime, without
    // reload, inside the latency contract (D4).
    const customerName = `Realtime Kunde ${world.runId}`;
    await expectLiveWithin(visibleText(bueroPage, customerName), {
      label: 'gg-00 customer list cross-session',
      actingPage: adminPage,
      mutation: (beforeSubmit) =>
        createCustomer(adminPage, customerName, {
          beforeSubmit,
        }),
    });
  });

  test('Einladung: Eingeladene Person tritt bei, sieht Büro-Oberflächen und meldet sich ab', async ({
    adminPage,
    browser,
    world,
  }) => {
    await test.step('Admin lädt als Büro ein, die eingeladene Person tritt über den Link bei', async () => {
      await inviteMember(adminPage, world.invitee.email, 'buero');
      // Reading the code from the database stands in for opening the invite
      // email; the join itself runs through the real link and login UI.
      const inviteCode = await getPendingInviteCode(world.orgId, world.invitee.email);
      const context = await browser.newContext({ locale: 'de-DE' });
      try {
        const page = await context.newPage();
        await joinOrganizationViaInviteLink(page, inviteCode, world.invitee, world.orgId);
        // Role-appropriate surface: the new Büro member reaches the manager-only
        // document library (employees are redirected away from it).
        await page.goto('/dokumente');
        await expect(page).toHaveURL(/\/dokumente$/);
        await expect(documentLibraryHeading(page)).toBeVisible();
      } finally {
        await context.close();
      }
    });

    await test.step('Die Mitgliederliste des Admins enthält das neue Mitglied', async () => {
      await adminPage.goto('/mitarbeiter');
      await expect(visibleText(adminPage, world.invitee.firstName)).toBeVisible();
    });

    // Sign-out revokes the user's sessions server-side, so this step uses the
    // invitee, the one member whose session no other test of the file uses.
    await test.step('Die neue Person meldet sich an und ab', async () => {
      const context = await browser.newContext({ locale: 'de-DE' });
      try {
        const page = await context.newPage();
        await loginViaUi(page, world.invitee);
        await signOutViaUi(page);
      } finally {
        await context.close();
      }
    });
  });

  test('Inventar: Mitarbeiter entnimmt Material auf dem Auftrag und legt es zurück', async ({
    employeePage,
    adminPage,
    world,
  }) => {
    const { itemId, itemName, locationId, initialQuantity } = world.inventory;
    const jobNumber = await seedAssignedJob(world, 'LAGER', `Materialauftrag ${world.runId}`);

    await takeMaterialOnJobPage(employeePage, jobNumber, itemName, 3);
    await expect(visibleText(employeePage, itemName)).toBeVisible();
    // The ledger arithmetic itself is asserted in supabase/tests/inventory_ledger.sql.
    expect((await getInventoryLedgerState(world.orgId, itemId, locationId)).quantityOnHand).toBe(
      initialQuantity - 3,
    );

    await returnMaterialOnJobPage(employeePage, jobNumber, itemName, 3);
    await expect(visibleText(employeePage, materialStillOutText(0))).toBeVisible();
    expect((await getInventoryLedgerState(world.orgId, itemId, locationId)).quantityOnHand).toBe(
      initialQuantity,
    );

    // The manager inventory surface shows the item after the round trip.
    await adminPage.goto('/inventar');
    await expect(visibleText(adminPage, itemName)).toBeVisible();
  });

  test('Mitarbeiter hat keinen Zugriff auf Bibliothek und Inventar', async ({ employeePage }) => {
    await expectRedirectedAway(employeePage, '/dokumente');
    await expectRedirectedAway(employeePage, '/inventar');
  });
});
