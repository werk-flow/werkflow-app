import { expect, test } from '../support/fixtures';
import { expectUsableWithin } from '../../golden/support/scenario-measurement';
import { usableContentTarget } from '../../golden/support/browser-observation';
import { customerListPager, customerSearchField } from '../../golden/support/steps/customers';
import { dismissDialog, pressKey } from '../../golden/support/steps/interaction';
import {
  jobPickerSearch,
  pagerButton,
  pagerCount,
  pagerRange,
  pagerRangeStart,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  projectJobPicker,
  projectJobPickerWithSelection,
  visibleJobSearch,
  workCreateButton,
  workCreateDialog,
  workCreateTab,
  workListPager,
} from '../../golden/support/steps/work';
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

  /* eslint-disable playwright-spec/no-copy-in-spec-locator -- measured scenarios customers.list.open, jobs.list.open, jobs.detail.open, equipment.list.open and tasks.list.open: its locators change only in the run that recalibrates its references (docs/technical/testing.md#deadlines-and-measured-scenarios) */
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
  /* eslint-enable playwright-spec/no-copy-in-spec-locator -- the measured test ends here */

  test('PERF-L3 pages and global search retain access to records beyond the initial page @AUDIT-PERFORMANCE-L3', async ({
    adminPage,
    world,
  }) => {
    await ensureTypicalProfile(world);
    await adminPage.goto('/kunden');
    const customerPages = customerListPager(adminPage);
    await expect(pagerCount(customerPages)).toContainText(pagerRange(1, 50, TYPICAL_PROFILE.customers));
    await pagerButton(customerPages, 'next').click();
    await expect(pagerCount(customerPages)).toContainText(pagerRange(51, 100, TYPICAL_PROFILE.customers));
    await expect(pagerButton(customerPages, 'previous')).toBeEnabled();
    const lastCustomer = `Kunde 1000 ${world.runId.slice(0, 6)}`;
    await customerSearchField(adminPage).fill(lastCustomer);
    await expect(visibleText(adminPage, lastCustomer)).toBeVisible();
    await expect(pagerCount(customerPages)).toHaveText(pagerRange(1, 1, 1));

    await adminPage.goto('/auftraege');
    const jobPages = workListPager(adminPage);
    await expect(pagerCount(jobPages)).toContainText(pagerRangeStart(1, 50));
    await pagerButton(jobPages, 'next').click();
    await expect(pagerCount(jobPages)).toContainText(pagerRangeStart(51, 100));
    // This is the oldest seeded active job, behind more than 1,000 newer active jobs.
    const oldestJob = `PERF-${world.runId.slice(0, 6)}-0001`;
    await visibleJobSearch(adminPage).fill(oldestJob);
    await expect(visibleText(adminPage, oldestJob)).toBeVisible();
    await expect(pagerCount(jobPages)).toHaveText(pagerRange(1, 1, 1));

    await workCreateButton(adminPage).click();
    const dialog = workCreateDialog(adminPage);
    await workCreateTab(dialog, 'project').click();
    const picker = projectJobPicker(dialog);
    await expect(picker).toBeEnabled();
    await picker.click();
    await jobPickerSearch(adminPage).fill(oldestJob);
    const option = adminPage.getByRole('listbox').getByRole('option').filter({ hasText: oldestJob });
    await expect(option).toHaveCount(1);
    await option.click();
    await pressKey(adminPage, 'Escape', { into: jobPickerSearch(adminPage) });
    await expect(projectJobPickerWithSelection(dialog, 1)).toBeVisible();
    // Reopening retains the exact selected entity after the query window changes.
    await projectJobPickerWithSelection(dialog, 1).click();
    await jobPickerSearch(adminPage).fill(oldestJob);
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await pressKey(adminPage, 'Escape', { into: jobPickerSearch(adminPage) });
    await dismissDialog(dialog);
  });
});
