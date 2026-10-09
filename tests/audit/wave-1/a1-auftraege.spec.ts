import type { Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { UNIFIED_STATUS_LABELS } from '../../../lib/jobs/types';
import { WORK_EXECUTION_LABELS } from '../../../lib/work-lifecycle/types';
import { createCustomer } from '../../golden/support/steps/customers';
import {
  detailActionsButton,
  employeeAssignmentPicker,
  SHARED_COPY,
  testData,
  textInDom,
  visibleMatchingText,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  addJobInstruction,
  chooseWorkListCustomer,
  clearPlannedDateOnJobPage,
  createJob,
  createProject,
  expandProjectButton,
  instructionCreatedBy,
  instructionStatusChangedBy,
  jobDetailField,
  jobDetailMenuItem,
  jobEditDialog,
  jobInstructionEditorFields,
  jobInstructionEditorRow,
  jobInstructionItem,
  jobInstructionMoveUp,
  jobInstructionToggle,
  jobTypeFilter,
  lifecycleBadge,
  parkWork,
  saveWorkColumnSettings,
  setInstructionCompletionOnJobPage,
  setPlannedDateOnJobPage,
  visibleJobSearch,
  visibleSortButton,
  workColumnSetting,
  workListColumnHeader,
  workListFilter,
  workListFilterPanel,
  workListFilterToggle,
  workListGroupText,
  workListOnlyProjectsOption,
  workListResetFilters,
  workListSection,
  WORK_LIST_SORT_COLUMNS,
} from '../../golden/support/steps/work';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { setJobStatus } from '../support/a1-steps';
import { observeRouteRenders } from '../../golden/support/route-renders';

function dateDigits(date: string): string {
  return date.split('-').reverse().join('');
}

/** Parks the job or project on the open detail page with the capacity reason and a follow-up in a week. */
async function parkOpenWork(page: Page, details: string, adminFirstName: string): Promise<void> {
  const parkDialog = await parkWork(page, {
    reason: 'capacity',
    details,
    responsibleName: adminFirstName,
    reviewDate: berlinDateAtOffset(7),
  });
  await expect(parkDialog).toHaveCount(0, { timeout: 20_000 });
}

test.describe('A1 Aufträge, Lebenszyklus und Auftragsliste @AUDIT-W1-A1', () => {
  test('A1-12/A1-13: Zuweisung entfernen, bearbeiten und Auftrag löschen', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `A1-EDIT-${world.runId}`;
    const title = `A1 Auftrag bearbeiten ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title,
      assignEmployeeName: 'Emil',
    });
    await employeePage.goto('/auftraege');
    await expect(visibleText(employeePage, jobNumber)).toBeVisible();

    // Each save renders the route once at most (tests/golden/route-renders.json).
    const renders = observeRouteRenders(adminPage, 'a1-auftraege');
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await detailActionsButton(adminPage).click();
    await jobDetailMenuItem(adminPage, 'edit').click();
    const dialog = jobEditDialog(adminPage);
    await dialog.locator('#edit-job-title').fill(`${title} geändert`);
    const employeePicker = employeeAssignmentPicker(dialog, 1);
    await expect(employeePicker).toBeEnabled({ timeout: 20_000 });
    await employeePicker.click();
    await adminPage
      .getByRole('listbox')
      .getByRole('option', { name: new RegExp(world.users.employee.firstName) })
      .click();
    // Close the multi-select popover via its trigger before submitting: the
    // pinned DialogFooter sits underneath it, and Playwright never dispatches
    // the outside click that would dismiss it for a real user. The trigger's
    // label changed with the deselection, so target it by its open state.
    await dialog.locator('button[role="combobox"][aria-expanded="true"]').click();
    await expect(adminPage.getByRole('listbox')).toBeHidden();
    await renders.forSave('job.edit', async () => {
      await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      await expect(visibleText(adminPage, testData`${title} geändert`)).toBeVisible();
    });
    await employeePage.reload();
    await expect(textInDom(employeePage, jobNumber)).toHaveCount(0);

    await detailActionsButton(adminPage).click();
    await jobDetailMenuItem(adminPage, 'delete').click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: SHARED_COPY.action.delete }).click();
    await expect(adminPage).toHaveURL((url) => url.pathname === '/auftraege', {
      timeout: 20_000,
    });
    await expect(adminPage.getByRole('row').filter({ hasText: jobNumber })).toHaveCount(0);
  });

  test('A1-15/A1-16: Entplanen bleibt Planung und Projektparken bewahrt fertige Kinder', async ({
    adminPage,
    world,
  }) => {
    const plannedDateDigits = dateDigits(ownedBerlinDateAtOffset('a1-auftraege', 21));
    const projectNumber = `A1-PARK-P-${world.runId}`;
    const unfinishedNumber = `A1-PARK-OFFEN-${world.runId}`;
    const finishedNumber = `A1-PARK-FERTIG-${world.runId}`;
    const parked = UNIFIED_STATUS_LABELS.parked;
    const executionComplete = WORK_EXECUTION_LABELS.execution_complete;
    await createProject(adminPage, { projectNumber, title: `A1 Parkprojekt ${world.runId}` });
    await createJob(adminPage, {
      jobNumber: unfinishedNumber,
      title: `A1 Parken offen ${world.runId}`,
      projectNumber,
      plannedDateDigits,
    });
    await createJob(adminPage, {
      jobNumber: finishedNumber,
      title: `A1 Parken fertig ${world.runId}`,
      projectNumber,
      plannedDateDigits,
    });
    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${finishedNumber}`);
    await setJobStatus(adminPage, 'execution_complete');
    await expect(visibleText(adminPage, executionComplete)).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${unfinishedNumber}`);
    await clearPlannedDateOnJobPage(adminPage);
    await expect(lifecycleBadge(adminPage, 'unplanned')).toBeVisible({
      timeout: 20_000,
    });
    await expect(textInDom(adminPage, parked)).toHaveCount(0);
    await setPlannedDateOnJobPage(adminPage, plannedDateDigits);
    await expect(textInDom(adminPage, parked)).toHaveCount(0);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleMatchingText(adminPage, /50\s*%/)).toBeVisible();
    await parkOpenWork(
      adminPage,
      'Projekt wird bis zur neuen Kapazitätsplanung geparkt.',
      world.users.admin.firstName,
    );
    await expect(visibleText(adminPage, parked)).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${unfinishedNumber}`);
    await expect(visibleText(adminPage, parked)).toBeVisible();
    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${finishedNumber}`);
    await expect(visibleText(adminPage, executionComplete)).toBeVisible();
    await expect(jobDetailField(adminPage, 'completionDate')).toBeVisible();
  });

  test('A1-17/A1-18: Checkliste, Attribution und Abschlussdatum', async ({
    adminPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const checklistJobNumber = `A1-CHECK-${world.runId}`;
    const pressureTest = testData`Anlage druckprüfen`;
    const labelValves = testData`Ventile beschriften`;
    await createJob(adminPage, {
      jobNumber: checklistJobNumber,
      title: `A1 Checkliste ${world.runId}`,
      assignEmployeeName: 'Emil',
    });
    await adminPage.goto(`/auftraege/${checklistJobNumber}`);
    await addJobInstruction(adminPage, pressureTest);
    await expect(instructionCreatedBy(adminPage, world.users.admin.firstName)).toBeVisible({
      timeout: 15_000,
    });
    const persistedInstruction = await jobInstructionEditorRow(adminPage, pressureTest);
    await expect(persistedInstruction.field).toHaveValue(pressureTest);
    await addJobInstruction(adminPage, labelValves);
    const secondInstruction = await jobInstructionEditorRow(adminPage, labelValves);
    await expect(secondInstruction.field).toBeVisible({ timeout: 15_000 });
    // The first frame of the move: the row as shown, while its order is unconfirmed.
    const moveSecondInstructionUp = jobInstructionMoveUp(secondInstruction.shown);
    await moveSecondInstructionUp.click();
    await expect(moveSecondInstructionUp).toBeDisabled();
    // Saved: the confirmed first point moved down, and reordering is available again.
    await expect(jobInstructionMoveUp(persistedInstruction.row)).toBeEnabled({ timeout: 20_000 });
    await adminPage.reload();
    const orderedInstructions = jobInstructionEditorFields(adminPage);
    await expect(orderedInstructions).toHaveCount(2);
    expect(
      await orderedInstructions.evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value),
      ),
    ).toEqual([labelValves, pressureTest]);

    const employeeFirstName = world.users.employee.firstName;
    await employeePage.goto(`/auftraege/${checklistJobNumber}`);
    await setInstructionCompletionOnJobPage(employeePage, labelValves, true);
    await expect(instructionStatusChangedBy(employeePage, 'done', employeeFirstName)).toBeVisible();
    await setInstructionCompletionOnJobPage(employeePage, labelValves, false);
    await expect(instructionStatusChangedBy(employeePage, 'open', employeeFirstName)).toBeVisible();
    await setInstructionCompletionOnJobPage(employeePage, labelValves, true);
    await expect(jobInstructionToggle(jobInstructionItem(employeePage, labelValves), 'open')).toBeVisible({
      timeout: 20_000,
    });
    await setInstructionCompletionOnJobPage(employeePage, pressureTest, true);
    await expect(jobInstructionToggle(jobInstructionItem(employeePage, pressureTest), 'open')).toBeVisible({
      timeout: 20_000,
    });

    await adminPage.reload();
    await setJobStatus(adminPage, 'execution_complete');
    await expect(jobDetailField(adminPage, 'completionDate')).toContainText(
      businessDate.split('-').reverse().join('.'),
      {
        timeout: 20_000,
      },
    );
  });

  test('A1-19: Auftragsliste sucht, filtert, sortiert, klappt Projekte auf und aktualisiert live [BASE-WORK-F08/P1-00-F01]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const listJobNumber = `A1-LIST-${world.runId}`;
    const otherJobNumber = `A1-LIST-X-${world.runId}`;
    const listCustomer = `A1 Listenkunde ${world.runId}`;
    const listDateDigits = dateDigits(ownedBerlinDateAtOffset('a1-auftraege', 20));
    await createCustomer(adminPage, listCustomer);
    await createJob(adminPage, {
      jobNumber: listJobNumber,
      title: `A1 Listenauftrag ${world.runId}`,
      clientName: listCustomer,
      assignEmployeeName: 'Emil',
      plannedDateDigits: listDateDigits,
    });
    await createJob(adminPage, {
      jobNumber: otherJobNumber,
      title: `A1 Listenauftrag ohne Kunde ${world.runId}`,
      plannedDateDigits: listDateDigits,
    });
    const listProjectNumber = `A1-LIST-P-${world.runId}`;
    await createProject(adminPage, {
      projectNumber: listProjectNumber,
      title: `A1 Listenprojekt ${world.runId}`,
      clientName: listCustomer,
    });
    const listChildNumber = `A1-LIST-C-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: listChildNumber,
      title: `A1 Listenprojektauftrag ${world.runId}`,
      projectNumber: listProjectNumber,
      assignEmployeeName: 'Emil',
      plannedDateDigits: dateDigits(ownedBerlinDateAtOffset('a1-auftraege', 21)),
    });
    const parkingJobNumber = `A1-PARK-LIST-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: parkingJobNumber,
      title: `A1 Parkplatzliste ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/${parkingJobNumber}`);
    await parkOpenWork(
      adminPage,
      'Auftrag bleibt bis zur nächsten Kapazitätsprüfung im Parkplatz.',
      world.users.admin.firstName,
    );
    const archiveJobNumber = `A1-ARCHIV-${world.runId}`;
    await createJob(adminPage, {
      jobNumber: archiveJobNumber,
      title: `A1 Archivliste ${world.runId}`,
      plannedDateDigits: listDateDigits,
    });
    await adminPage.goto(`/auftraege/${archiveJobNumber}`);
    await setJobStatus(adminPage, 'execution_complete');
    await adminPage.goto('/auftraege');
    const search = visibleJobSearch(adminPage);
    await search.fill(listJobNumber);
    await expect(visibleText(adminPage, listJobNumber)).toBeVisible();
    await search.fill('kein-treffer-a1');
    await expect(textInDom(adminPage, listJobNumber)).toHaveCount(0);
    await search.fill('');
    const activeSection = workListSection(adminPage);
    await workListFilterToggle(activeSection).click();
    const filterPanel = workListFilterPanel(activeSection);
    await chooseWorkListCustomer(adminPage, filterPanel, listCustomer);
    await expect(visibleText(adminPage, listJobNumber)).toBeVisible();
    await expect(textInDom(adminPage, otherJobNumber)).toHaveCount(0);
    await workListFilter(filterPanel, 'employee').click();
    await adminPage.getByRole('option', { name: new RegExp(world.users.employee.firstName) }).click();
    await expect(visibleText(adminPage, listProjectNumber)).toBeVisible();
    await jobTypeFilter(filterPanel).click();
    await workListOnlyProjectsOption(adminPage).click();
    await expect(textInDom(adminPage, listJobNumber)).toHaveCount(0);
    await expect(visibleText(adminPage, listProjectNumber)).toBeVisible();
    await workListResetFilters(activeSection).click();

    for (const heading of WORK_LIST_SORT_COLUMNS) {
      const sortButton = visibleSortButton(activeSection, heading);
      await expect(sortButton).toBeVisible();
      await sortButton.click();
    }
    const projectRow = activeSection.getByRole('row').filter({ hasText: listProjectNumber });
    await expandProjectButton(projectRow).click();
    await expect(visibleText(adminPage, listChildNumber)).toBeVisible();
    await expect(workListGroupText(adminPage, 'parking')).toBeVisible();
    await expect(workListGroupText(adminPage, 'archive')).toBeVisible();

    const liveJobNumber = `A1-LIVE-${world.runId}`;
    await search.fill(liveJobNumber);
    await expect(textInDom(adminPage, liveJobNumber)).toHaveCount(0);
    await createJob(bueroPage, {
      jobNumber: liveJobNumber,
      title: `A1 Liveauftrag ${world.runId}`,
      plannedDateDigits: dateDigits(ownedBerlinDateAtOffset('a1-auftraege', 150)),
    });
    await expect(visibleText(adminPage, liveJobNumber)).toBeVisible({
      timeout: 30_000,
    });
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });

  test('A1-20: Auftrags-Spalten bleiben pro Nutzer wählbar [BASE-WORK-F08]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    await createJob(adminPage, {
      jobNumber: `A1-COLUMNS-${world.runId}`,
      title: `A1 Spaltenprüfung ${world.runId}`,
      plannedDateDigits: dateDigits(ownedBerlinDateAtOffset('a1-auftraege', 150)),
    });
    await bueroPage.goto('/einstellungen/auftraege-projekte');
    const bueroCustomerCheckbox = workColumnSetting(bueroPage, 'customer');
    const bueroWasChecked = await bueroCustomerCheckbox.isChecked();

    await adminPage.goto('/einstellungen/auftraege-projekte');
    const customerCheckbox = workColumnSetting(adminPage, 'customer');
    const wasChecked = await customerCheckbox.isChecked();
    await customerCheckbox.click();
    await saveWorkColumnSettings(adminPage);
    await adminPage.goto('/auftraege');
    const adminCustomerColumn = workListColumnHeader(adminPage, 'customer');
    if (wasChecked) {
      await expect(adminCustomerColumn).toHaveCount(0);
    } else {
      await expect(adminCustomerColumn).toBeVisible();
    }

    await bueroPage.reload();
    await expect(bueroCustomerCheckbox).toBeChecked({
      checked: bueroWasChecked,
    });
    await bueroPage.goto('/auftraege');
    const bueroCustomerColumn = workListColumnHeader(bueroPage, 'customer');
    if (bueroWasChecked) {
      await expect(bueroCustomerColumn).toBeVisible();
    } else {
      await expect(bueroCustomerColumn).toHaveCount(0);
    }

    // The column choice persists per user; restore the admin's choice.
    await adminPage.goto('/einstellungen/auftraege-projekte');
    await workColumnSetting(adminPage, 'customer').click();
    await saveWorkColumnSettings(adminPage);
  });
});
