import { expect, test } from '../support/fixtures';
import { bannerTarget, boardCardTarget } from '../../golden/support/browser-observation';
import { berlinDateAtOffset } from '../../golden/support/date-ownership';
import { getTimeEntryStatuses, seedPendingManualInterval } from '../../golden/support/db/time-tracking';
import { getJobCountByNumber } from '../../golden/support/db/work';
import { closeOccurrenceOverviewButton } from '../../golden/support/steps/calendar';
import { customerSearchField } from '../../golden/support/steps/customers';
import { openTimeApprovals } from '../../golden/support/steps/time-tracking';
import {
  jobFormField,
  visibleJobSearch,
  workCreateButton,
  workCreateDialog,
  workCreateSubmit,
  workCreateTab,
} from '../../golden/support/steps/work';
import {
  appSidebarLink,
  approveSubmission,
  boardCardTitle,
  customerResultCount,
  jobDetailReady,
  jobListEntry,
  jobListReady,
  neighbourBoardRow,
  responsibilitySettingsReady,
  settingsSectionLink,
  taskListReady,
} from '../support/lab-journeys';
import { openLabSession, recordLabStep } from '../support/lab-recorder';
import { ensureTypicalProfile, liveWeekStart, MEASURED_VISIT_TITLE } from '../support/performance-profile';
import {
  boardCellOf,
  calendarReady,
  holdPointerDrag,
  pendingApprovalCard,
  seededBoardCard,
  usableListCount,
} from '../support/performance-steps';

// Lab counts of the office's and the owner's journeys (lib/testing/journeys.ts),
// on the typical profile at a laptop width. Each step id is registered in
// lib/testing/lab-steps.ts; the runner compares every record with
// lib/testing/lab-count-references.json.

test.describe('Lab counts of the office @AUDIT-LAB-OFFICE', () => {
  test('LAB-O1 the office opens a job from the list and goes back @AUDIT-LAB-O1', async ({
    browser,
    baseURL,
    world,
  }) => {
    const { assignedJobNumber } = await ensureTypicalProfile(world);
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.office.cold-start' });
    try {
      await recordLabStep(lab, 'lab.office.cold-start', {
        trigger: () => lab.page.goto('/auftraege'),
        usable: jobListReady(lab.page),
        rows: () => usableListCount(lab.page, 'auftraege'),
      });
      await visibleJobSearch(lab.page).fill(assignedJobNumber);
      // The office points at the row before it clicks; the recorder starts once the page is quiet again.
      await jobListEntry(lab.page, MEASURED_VISIT_TITLE).hover();
      await recordLabStep(lab, 'lab.office.job-open', {
        trigger: () => jobListEntry(lab.page, MEASURED_VISIT_TITLE).click(),
        usable: jobDetailReady(lab.page),
      });
      await expect(lab.page).toHaveURL(new RegExp(`/auftraege/${assignedJobNumber}$`));
      await recordLabStep(lab, 'lab.office.job-back', {
        trigger: () => lab.page.goBack(),
        usable: jobListReady(lab.page),
        rows: () => usableListCount(lab.page, 'auftraege'),
      });
      await expect(jobListEntry(lab.page, MEASURED_VISIT_TITLE)).toBeVisible();
    } finally {
      await lab.dispose();
    }
  });

  test('LAB-O2 the office finds a customer by name @AUDIT-LAB-O2', async ({ browser, baseURL, world }) => {
    await ensureTypicalProfile(world);
    const customer = `Kunde 0742 ${world.runId.slice(0, 6)}`;
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.office.customer-find' });
    try {
      await lab.page.goto('/kunden');
      await expect(customerSearchField(lab.page)).toBeVisible();
      await recordLabStep(lab, 'lab.office.customer-find', {
        trigger: () => customerSearchField(lab.page).fill(customer),
        usable: customerResultCount(lab.page, 1),
      });
    } finally {
      await lab.dispose();
    }
  });

  test('LAB-O3 the office creates a job @AUDIT-LAB-O3', async ({ browser, baseURL, world }) => {
    await ensureTypicalProfile(world);
    const jobNumber = `LAB-${world.runId.slice(0, 6)}`;
    const title = `Heizung prüfen ${world.runId.slice(0, 6)}`;
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.office.job-create' });
    try {
      await lab.page.goto('/auftraege');
      await expect(jobListReady(lab.page)).toBeVisible();
      await workCreateButton(lab.page).click();
      const dialog = workCreateDialog(lab.page);
      await workCreateTab(dialog, 'job').click();
      await jobFormField(dialog, 'number').fill(jobNumber);
      await jobFormField(dialog, 'title').fill(title);
      await recordLabStep(lab, 'lab.office.job-create', {
        trigger: () => workCreateSubmit(dialog, 'job').click(),
        usable: jobListEntry(lab.page, title),
      });
      expect(await getJobCountByNumber(world.orgId, jobNumber)).toBe(1);
    } finally {
      await lab.dispose();
    }
  });

  test("LAB-O4 the office moves a visit to another person's day @AUDIT-LAB-O4", async ({
    browser,
    baseURL,
    world,
  }) => {
    await ensureTypicalProfile(world);
    const liveDate = liveWeekStart();
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.office.visit-move' });
    try {
      await lab.page.goto(`/kalender?date=${liveDate}`);
      await expect(calendarReady(lab.page, 'week')).toBeVisible({ timeout: 30_000 });
      const card = seededBoardCard(lab.page);
      await expect(card).toBeVisible();
      const title = await boardCardTitle(card);
      await recordLabStep(lab, 'lab.office.entry-open', {
        trigger: () => card.click(),
        usable: closeOccurrenceOverviewButton(lab.page),
      });
      await closeOccurrenceOverviewButton(lab.page).click();
      await expect(closeOccurrenceOverviewButton(lab.page)).toBeHidden();
      const rows = await neighbourBoardRow(lab.page, card);
      const release = await holdPointerDrag(lab.page, card, boardCellOf(lab.page, rows.target, liveDate));
      await recordLabStep(lab, 'lab.office.visit-move', {
        trigger: release,
        usable: bannerTarget(lab.page, 'verschoben').locator,
      });
      await expect(boardCardTarget(lab.page, title, rows.target).locator).toBeVisible();
    } finally {
      await lab.dispose();
    }
  });

  test('LAB-O5 the office approves an open time submission @AUDIT-LAB-O5', async ({
    browser,
    baseURL,
    world,
  }) => {
    await ensureTypicalProfile(world);
    const employee = world.users.employee;
    const submission = await seedPendingManualInterval({
      organizationId: world.orgId,
      userId: employee.id,
      date: berlinDateAtOffset(-9),
      from: '14:07',
      to: '15:52',
    });
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.office.time-approve' });
    try {
      await openTimeApprovals(lab.page);
      const card = pendingApprovalCard(lab.page, employee.id, '14:07 – 15:52');
      await expect(card).toHaveCount(1);
      await recordLabStep(lab, 'lab.office.time-approve', {
        trigger: () => approveSubmission(card).click(),
        usable: bannerTarget(lab.page, 'genehmigt').locator,
      });
    } finally {
      await lab.dispose();
    }
    expect(await getTimeEntryStatuses(world.orgId, [submission.clockInId, submission.clockOutId])).toEqual([
      'approved',
      'approved',
    ]);
  });

  test('LAB-A1 the owner opens the task list from the sidebar @AUDIT-LAB-A1', async ({
    browser,
    baseURL,
    world,
  }) => {
    await ensureTypicalProfile(world);
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.admin.tasks-open' });
    try {
      await lab.page.goto('/dashboard');
      await expect(appSidebarLink(lab.page, '/aufgaben')).toBeVisible();
      await recordLabStep(lab, 'lab.admin.tasks-open', {
        trigger: () => appSidebarLink(lab.page, '/aufgaben').click(),
        usable: taskListReady(lab.page),
      });
    } finally {
      await lab.dispose();
    }
  });

  test('LAB-A2 the owner opens the employee settings @AUDIT-LAB-A2', async ({ browser, baseURL, world }) => {
    await ensureTypicalProfile(world);
    const lab = await openLabSession({ browser, baseURL, world, profileStep: 'lab.admin.settings-open' });
    try {
      await lab.page.goto('/einstellungen/profil');
      await expect(settingsSectionLink(lab.page, '/einstellungen/mitarbeiter')).toBeVisible();
      await recordLabStep(lab, 'lab.admin.settings-open', {
        trigger: () => settingsSectionLink(lab.page, '/einstellungen/mitarbeiter').click(),
        usable: responsibilitySettingsReady(lab.page),
      });
    } finally {
      await lab.dispose();
    }
  });
});
