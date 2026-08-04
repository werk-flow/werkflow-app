import { resolve } from 'node:path';

import { expect, test } from './support/fixtures';
import {
  clockInOnJob,
  clockOut,
  createCustomer,
  createJob,
  expectRedirectedAway,
  signOutViaUi,
  uploadDocumentOnJobPage,
  visibleText,
} from './support/steps';
import { ARTIFACTS_DIR, storageStatePath } from './support/world';

// GG-00 — Existing Foundation Regression (@GG-00)
// Verifies the roadmap's baseline scenario: role-scoped core flows, document
// upload via direct-to-R2, organization isolation, and sign-out.

test.describe.configure({ mode: 'serial' });

test.describe('GG-00 Bestandsfunktionen @GG-00', () => {
  test('Admin legt einen Kunden an', async ({ adminPage, world }) => {
    await createCustomer(adminPage, `Testkunde ${world.runId}`);
    await adminPage.goto('/kunden');
    await expect(visibleText(adminPage, `Testkunde ${world.runId}`)).toBeVisible();
  });

  test('Admin erstellt Aufträge und weist einen Mitarbeiter zu', async ({
    adminPage,
    world,
  }) => {
    await createJob(adminPage, {
      jobNumber: `GG-${world.runId}-1`,
      title: 'Heizung warten (Golden Gate)',
      assignEmployeeName: 'Emil',
    });
    await createJob(adminPage, {
      jobNumber: `GG-${world.runId}-2`,
      title: 'Bad sanieren (nicht zugewiesen)',
    });

    await adminPage.goto('/auftraege');
    await expect(visibleText(adminPage, `GG-${world.runId}-1`)).toBeVisible();
    await expect(visibleText(adminPage, `GG-${world.runId}-2`)).toBeVisible();
  });

  test('Mitarbeiter sieht nur zugewiesene Aufträge', async ({ employeePage, world }) => {
    await employeePage.goto('/auftraege');
    await expect(visibleText(employeePage, `GG-${world.runId}-1`)).toBeVisible();
    await expect(employeePage.getByText(`GG-${world.runId}-2`)).toHaveCount(0);
  });

  test('Mitarbeiter lädt ein Dokument über 4,5 MB auf den Auftrag hoch', async ({
    employeePage,
    world,
  }) => {
    await uploadDocumentOnJobPage(
      employeePage,
      `GG-${world.runId}-1`,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );
  });

  test('Büro sieht die Dokumentbibliothek mit dem hochgeladenen Dokument', async ({
    bueroPage,
  }) => {
    await bueroPage.goto('/dokumente');
    await expect(visibleText(bueroPage, 'upload-fixture')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Mitarbeiter erfasst auftragsbezogene Arbeitszeit', async ({ employeePage }) => {
    await clockInOnJob(employeePage, 'Heizung warten (Golden Gate)');
    await clockOut(employeePage);
  });

  test('Realtime: Büro sieht neue Kunden ohne Neuladen', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // Two users are signed in simultaneously in separate browser contexts.
    await bueroPage.goto('/kunden');
    await expect(visibleText(bueroPage, `Testkunde ${world.runId}`)).toBeVisible();

    await createCustomer(adminPage, `Realtime Kunde ${world.runId}`);

    // The Büro page must pick the new customer up via Realtime, without reload.
    await expect(visibleText(bueroPage, `Realtime Kunde ${world.runId}`)).toBeVisible({
      timeout: 30_000,
    });
  });

  test('Mobil: Mitarbeiter sieht zugewiesene Aufträge auf kleinem Viewport', async ({
    browser,
    world,
  }) => {
    const context = await browser.newContext({
      storageState: storageStatePath('employee'),
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto('/auftraege');
    await expect(visibleText(page, `GG-${world.runId}-1`)).toBeVisible();
    await context.close();
  });

  test('Mitarbeiter hat keinen Zugriff auf Bibliothek und Inventar', async ({
    employeePage,
  }) => {
    await expectRedirectedAway(employeePage, '/dokumente');
    await expectRedirectedAway(employeePage, '/inventar');
  });

  test('Fremde Organisation sieht keine Daten', async ({ outsiderPage, world }) => {
    await outsiderPage.goto('/kunden');
    await expect(outsiderPage.getByText(`Testkunde ${world.runId}`)).toHaveCount(0);
    await outsiderPage.goto('/auftraege');
    await expect(outsiderPage.getByText(`GG-${world.runId}-1`)).toHaveCount(0);
  });

  test('Mitarbeiter kann sich abmelden', async ({ employeePage }) => {
    await signOutViaUi(employeePage);
  });
});
