import { expect, test } from '../support/fixtures';
import { expectUsableWithin } from '../../golden/support/scenario-measurement';
import { usableContentTarget } from '../../golden/support/browser-observation';
import { visibleText } from '../../golden/support/steps/shared';
import { ensureTypicalProfile, TYPICAL_PROFILE } from '../support/performance-profile';
import { createPerformancePage, loadingList, usableListCount } from '../support/performance-steps';
import { LIST_PAGE_SIZE } from '../../../lib/ui/list-pagination';

// Measures a usable first page under the full organization workload, the
// soft navigation from the job list into one job, and the Anlagen and
// Aufgaben pages of the office. Separate untimed checks below prove global
// search and page navigation. Every test prepares the profile it reads.

test.describe('Performance profile lists @AUDIT-PERFORMANCE', () => {
  test("PERF-L1 seeds the typical profile into the group's organization @AUDIT-PERFORMANCE-L1", async ({
    world,
  }) => {
    const counts = await ensureTypicalProfile(world);
    expect(counts.customers).toBe(TYPICAL_PROFILE.customers);
    expect(counts.jobs).toBe(TYPICAL_PROFILE.jobs);
    expect(counts.equipment).toBe(TYPICAL_PROFILE.equipment);
    expect(counts.pendingSubmissions).toBe(TYPICAL_PROFILE.pendingSubmissions);
    expect(counts.assignments).toBeGreaterThan(0);
  });

  test('PERF-L2 the office lists and a job open with the typical profile @AUDIT-PERFORMANCE-L2', async ({
    browser,
    baseURL,
    world,
  }) => {
    const { assignedJobNumber: seeded } = await ensureTypicalProfile(world);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    for (const sample of [1, 2, 3]) {
      const { dispose, page } = await createPerformancePage({
        browser,
        baseUrl: baseURL,
        world,
        role: 'admin',
      });
      try {
        await test.step(`Declared list navigation sample ${sample}`, async () => {
          await expectUsableWithin('customers.list.open', {
            page,
            trigger: () => page.goto('/kunden'),
            usable: usableContentTarget(page, 'kunden'),
          });
          expect(await usableListCount(page, 'kunden')).toBe(LIST_PAGE_SIZE);
          await expect(
            page
              .getByRole('navigation', { name: 'Kunden', exact: true })
              .getByRole('status', { name: 'Eintragsanzahl', exact: true }),
          ).toContainText(`von ${TYPICAL_PROFILE.customers}`);

          await expectUsableWithin('jobs.list.open', {
            page,
            trigger: () => page.goto('/auftraege'),
            usable: usableContentTarget(page, 'auftraege'),
          });
          expect(await usableListCount(page, 'auftraege')).toBeGreaterThan(0);
          expect(await usableListCount(page, 'auftraege')).toBeLessThanOrEqual(LIST_PAGE_SIZE * 2);
          // Assignment completeness is an untimed global-search assertion, independent
          // of the user's sort preference and the first page's identities.
          await page
            .getByRole('main')
            .getByPlaceholder('Suche nach Titel, Nummer, Kunde, Ort…')
            .filter({ visible: true })
            .fill(seeded);
          await expect(
            page
              .getByRole('navigation', { name: 'Aktuelle Aufträge', exact: true })
              .getByRole('status', { name: 'Eintragsanzahl', exact: true }),
          ).toHaveText('1–1 von 1');
          await expect(visibleText(page, seeded)).toBeVisible();
          await expect(
            page.getByRole('main').getByLabel(employeeName, { exact: true }).filter({ visible: true }),
          ).toBeVisible();
          await expect(loadingList(page, 'auftraege')).toHaveCount(0);

          // The office opens the found job from its row: a client navigation into the detail.
          await expectUsableWithin('jobs.detail.open', {
            page,
            trigger: () => page.getByRole('main').getByRole('row').filter({ hasText: seeded }).click(),
            usable: usableContentTarget(page, 'auftrag'),
          });
          await expect(page).toHaveURL(new RegExp(`/auftraege/${seeded}$`));

          await expectUsableWithin('equipment.list.open', {
            page,
            trigger: () => page.goto('/service/anlagen'),
            usable: usableContentTarget(page, 'anlagen'),
          });
          expect(await usableListCount(page, 'anlagen')).toBe(LIST_PAGE_SIZE);
          await expect(
            page
              .getByRole('navigation', { name: 'Anlagen', exact: true })
              .getByRole('status', { name: 'Eintragsanzahl', exact: true }),
          ).toContainText(`von ${TYPICAL_PROFILE.equipment}`);

          await expectUsableWithin('tasks.list.open', {
            page,
            trigger: () => page.goto('/aufgaben'),
            usable: usableContentTarget(page, 'aufgaben'),
          });
          // The profile's open submissions are approval tasks of the administrator.
          expect(await usableListCount(page, 'aufgaben')).toBeGreaterThanOrEqual(
            TYPICAL_PROFILE.pendingSubmissions,
          );
        });
      } finally {
        await dispose();
      }
    }
  });

  test('PERF-L3 pages and global search retain access to records beyond the initial page @AUDIT-PERFORMANCE-L3', async ({
    adminPage,
    world,
  }) => {
    await ensureTypicalProfile(world);
    await adminPage.goto('/kunden');
    const customerPages = adminPage.getByRole('navigation', { name: 'Kunden', exact: true });
    await expect(customerPages.getByRole('status', { name: 'Eintragsanzahl', exact: true })).toContainText(
      `1–50 von ${TYPICAL_PROFILE.customers}`,
    );
    await customerPages.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(customerPages.getByRole('status', { name: 'Eintragsanzahl', exact: true })).toContainText(
      `51–100 von ${TYPICAL_PROFILE.customers}`,
    );
    await expect(customerPages.getByRole('button', { name: 'Zurück', exact: true })).toBeEnabled();
    const lastCustomer = `Kunde 1000 ${world.runId.slice(0, 6)}`;
    await adminPage.getByPlaceholder('Kunde, Ansprechpartner, Einsatzort…').fill(lastCustomer);
    await expect(visibleText(adminPage, lastCustomer)).toBeVisible();
    await expect(customerPages.getByRole('status', { name: 'Eintragsanzahl', exact: true })).toHaveText(
      '1–1 von 1',
    );

    await adminPage.goto('/auftraege');
    const jobPages = adminPage.getByRole('navigation', { name: 'Aktuelle Aufträge', exact: true });
    await expect(jobPages.getByRole('status', { name: 'Eintragsanzahl', exact: true })).toContainText(
      '1–50 von',
    );
    await jobPages.getByRole('button', { name: 'Weiter', exact: true }).click();
    await expect(jobPages.getByRole('status', { name: 'Eintragsanzahl', exact: true })).toContainText(
      '51–100 von',
    );
    // This is the oldest seeded active job, behind more than 1,000 newer active jobs.
    const oldestJob = `PERF-${world.runId.slice(0, 6)}-0001`;
    await adminPage
      .getByRole('main')
      .getByPlaceholder('Suche nach Titel, Nummer, Kunde, Ort…')
      .filter({ visible: true })
      .fill(oldestJob);
    await expect(visibleText(adminPage, oldestJob)).toBeVisible();
    await expect(jobPages.getByRole('status', { name: 'Eintragsanzahl', exact: true })).toHaveText(
      '1–1 von 1',
    );

    await adminPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    const dialog = adminPage
      .getByRole('dialog')
      .filter({ has: adminPage.getByRole('heading', { name: 'Neuen Auftrag oder Projekt erstellen' }) });
    await dialog.getByRole('tab', { name: 'Projekt erstellen', exact: true }).click();
    const picker = dialog.getByRole('combobox').filter({ hasText: 'Aufträge zuweisen' });
    await expect(picker).toBeEnabled();
    await picker.click();
    await adminPage.getByPlaceholder('Auftrag suchen…').fill(oldestJob);
    const option = adminPage.getByRole('listbox').getByRole('option').filter({ hasText: oldestJob });
    await expect(option).toHaveCount(1);
    await option.click();
    await adminPage.keyboard.press('Escape');
    await expect(dialog.getByRole('combobox').filter({ hasText: '1 Auftrag' })).toBeVisible();
    // Reopening retains the exact selected entity after the query window changes.
    await dialog.getByRole('combobox').filter({ hasText: '1 Auftrag' }).click();
    await adminPage.getByPlaceholder('Auftrag suchen…').fill(oldestJob);
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await adminPage.keyboard.press('Escape');
    await adminPage.keyboard.press('Escape');
  });
});
