import { expect, test } from '../support/fixtures';
import { expectButtonTextContrast } from '../support/button-contrast';
import { getJobCountByNumber, getJobProjectNumber } from '../../golden/support/db/work';
import {
  addCustomerButton,
  createCustomer,
  customerCountLabel,
  customerCountPattern,
  customerCreateDialog,
  customerCreateHeading,
  customerCreateSubmit,
  customerDeleteMenuItem,
  customerFormField,
  customerSearchField,
  inlineCustomerCreateButton,
  openCustomerDetail,
} from '../../golden/support/steps/customers';
import { dismissDialog } from '../../golden/support/steps/interaction';
import { editMetadataTextField } from '../../golden/support/steps/personnel';
import {
  customerPicker,
  customerPickerSearch,
  detailActionsButton,
  detailsRegion,
  employeeAssignmentPicker,
  employeeAssignmentSearch,
  SHARED_COPY,
  testData,
  typeIntoTimeInput,
  visibleMatchingText,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  confirmLifecycleReason,
  createJob,
  createProject,
  expandProjectButton,
  expectWorkTransitionSaved,
  jobFormField,
  lifecycleAction,
  lifecycleState,
  projectDeleteMenuItem,
  projectJobAssignmentDialog,
  projectJobPicker,
  projectScheduleIndicators,
  typeWorkCreatePlannedDate,
  WORK_DETAIL_TEXT,
  workCreateButton,
  workCreateDialog,
  workCreateHeading,
  workCreateJobNumberField,
  workCreateSubmit,
  workCreateTab,
  workTransitionSave,
} from '../../golden/support/steps/work';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { CLIENT_TYPE_LABELS, JOB_PRIORITY_LABELS, PROJECT_STATUS_LABELS } from '../../../lib/jobs/types';
import { formatDuration } from '../../../lib/time-tracking/helpers';
import { workTransitionActionLabel } from '../../../lib/work-lifecycle/types';
import { setJobStatus } from '../support/a1-steps';

test.describe('A1 Kunden und Auftragsdaten @AUDIT-W1-A1', () => {
  test('A1-09/A1-11: Kundendaten inline und Kunde direkt im Arbeitsdialog', async ({ adminPage, world }) => {
    const customerName = `A1 Kunde ${world.runId}`;
    const renamedCustomerName = `A1 Kunde Neu ${world.runId}`;
    const customerEmail = `a1-kunde-${world.runId}@example.de`;
    const customerPhone = '+49 30 1234567';
    const customerAddress = testData`Werkstraße 42, 10115 Berlin`;
    const customerNotes = testData`Bevorzugt Termine am Vormittag`;
    await adminPage.goto('/kunden');
    const initialCount = Number((await customerCountLabel(adminPage).textContent())?.split(' ')[0]);
    await addCustomerButton(adminPage).click();
    const createCustomerDialog = customerCreateDialog(adminPage);
    await customerFormField(createCustomerDialog, 'name').fill(customerName);
    await customerFormField(createCustomerDialog, 'type').click();
    await adminPage.getByRole('option', { name: CLIENT_TYPE_LABELS.gewerblich, exact: true }).click();
    await customerFormField(createCustomerDialog, 'email').fill(customerEmail);
    await customerFormField(createCustomerDialog, 'phone').fill(customerPhone);
    await customerFormField(createCustomerDialog, 'address').fill(customerAddress);
    await customerFormField(createCustomerDialog, 'notes').fill(customerNotes);
    await customerCreateSubmit(adminPage).click();
    await expect(customerCreateHeading(adminPage)).toBeHidden({
      timeout: 10_000,
    });
    // Documented delayed-refresh class (see the P1-02 golden-gate-log entry):
    // the post-create router.refresh() can arrive late under suite load. Give
    // it 15s, then reload once — the persisted count assertion stays strict.
    const nextCount = visibleMatchingText(adminPage, customerCountPattern(initialCount + 1));
    try {
      await expect(nextCount).toBeVisible({ timeout: 15_000 });
    } catch {
      await adminPage.reload();
      await expect(nextCount).toBeVisible({ timeout: 15_000 });
    }
    const customerRow = adminPage.getByRole('row').filter({ hasText: customerName });
    await expect(customerRow).toContainText(CLIENT_TYPE_LABELS.gewerblich);
    await expect(customerRow).toContainText(customerEmail);
    await expect(customerRow).toContainText(customerPhone);
    await customerSearchField(adminPage).fill(customerPhone);
    await expect(customerRow).toBeVisible();
    await customerSearchField(adminPage).fill('kein-a1-kunde');
    await expect(customerRow).toHaveCount(0);
    await customerSearchField(adminPage).fill('');
    await expect(customerRow).toBeVisible();
    // Typed search: each pause beyond the 250 ms debounce commits a URL and
    // remounts the keyed list. Keystrokes, the pending navigation and focus
    // must survive those commits (review finding, 2026-09-13).
    const customerSearch = customerSearchField(adminPage);
    await customerSearch.click();
    await customerSearch.pressSequentially('kein-a1-kunde', { delay: 300 });
    await expect(customerSearch).toHaveValue('kein-a1-kunde');
    await expect(customerSearch).toBeFocused();
    await expect(adminPage).toHaveURL(/[?&]q=kein-a1-kunde(&|$)/);
    await expect(customerRow).toHaveCount(0);
    await customerSearch.fill('');
    await expect(customerRow).toBeVisible();
    await openCustomerDetail(adminPage, customerName);
    await expect(visibleText(adminPage, customerAddress)).toBeVisible();
    await expect(visibleText(adminPage, customerNotes)).toBeVisible();
    await editMetadataTextField(adminPage, 'Name', renamedCustomerName);
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible({
      timeout: 15_000,
    });
    await adminPage.reload();
    await expect(visibleText(adminPage, renamedCustomerName)).toBeVisible();

    const inlineCustomer = `A1 Inlinekunde ${world.runId}`;
    await adminPage.goto('/auftraege');
    await workCreateButton(adminPage).click();
    await workCreateTab(adminPage, 'job').click();
    await customerPicker(adminPage).click();
    await inlineCustomerCreateButton(adminPage).click();
    await customerFormField(adminPage.getByRole('dialog'), 'name').fill(inlineCustomer);
    await customerCreateSubmit(adminPage).click();
    await expect(customerCreateHeading(adminPage)).toBeHidden({
      timeout: 15_000,
    });
    await expect(adminPage.getByRole('combobox').filter({ hasText: inlineCustomer })).toBeVisible();
    const inlineJobNumber = `A1-INLINE-${world.runId}`;
    const createJobDialog = workCreateDialog(adminPage);
    await workCreateJobNumberField(createJobDialog).fill(inlineJobNumber);
    await createJobDialog.getByLabel(SHARED_COPY.field.title).fill(`A1 Inlineauftrag ${world.runId}`);
    await workCreateSubmit(adminPage, 'job').click();
    await expect(workCreateHeading(adminPage)).toBeHidden();
    // Deferred creation closes the dialog before persistence. Navigation must
    // not abort its queued save, and a visible optimistic draft is insufficient.
    await expect.poll(() => getJobCountByNumber(world.orgId, inlineJobNumber)).toBe(1);
    // The list re-reads the customer name after the deferred save lands; under suite
    // load that read can trail the persisted row. Give it 15 s, then reload once.
    const inlineRow = adminPage.getByRole('row').filter({ hasText: inlineJobNumber });
    try {
      await expect(inlineRow).toContainText(inlineCustomer, { timeout: 15_000 });
    } catch {
      await adminPage.reload();
      await expect(inlineRow).toContainText(inlineCustomer, { timeout: 15_000 });
    }
    await adminPage.goto(`/auftraege/${inlineJobNumber}`);
    await expect(visibleText(adminPage, inlineCustomer)).toBeVisible();
  });

  test('A1-R01: vollständige Auftragsdaten, Mehrfachzuweisung und Projektableitung [BASE-WORK-F01/F02/F05/F07]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const customerName = `A1 Vollkunde ${world.runId}`;
    const projectNumber = `A1-FULL-P-${world.runId}`;
    const projectTitle = `A1 Vollständiges Projekt ${world.runId}`;
    const jobNumber = `A1-FULL-J-${world.runId}`;
    const jobTitle = `A1 Vollständiger Auftrag ${world.runId}`;
    const jobDescription = testData`Vollständige Auftragsbeschreibung`;
    const jobLocation = testData`Heizraum, Werkstraße 42`;
    const firstAssignee = world.users.employee.firstName;
    const secondAssignee = world.users.buero.firstName;
    const plannedDate = ownedBerlinDateAtOffset('a1-kunden', 65);

    await createCustomer(adminPage, customerName);
    await createProject(adminPage, {
      projectNumber,
      title: projectTitle,
      clientName: customerName,
    });
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleText(adminPage, WORK_DETAIL_TEXT.projectHasNoJobs)).toBeVisible();
    await editMetadataTextField(adminPage, 'Beschreibung', 'Vollständige Projektbeschreibung');

    await adminPage.goto('/auftraege');
    await workCreateButton(adminPage).click();
    const createDialog = workCreateDialog(adminPage);
    await workCreateTab(createDialog, 'job').click();
    await jobFormField(createDialog, 'number').fill(jobNumber);
    await jobFormField(createDialog, 'title').fill(jobTitle);
    await jobFormField(createDialog, 'description').fill(jobDescription);
    await customerPicker(createDialog).click();
    const customerSearch = customerPickerSearch(adminPage);
    await customerSearch.fill(customerName);
    const customerOption = adminPage
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: customerName });
    await expect(customerOption).toBeVisible({ timeout: 10_000 });
    await customerOption.click();
    await jobFormField(createDialog, 'priority').click();
    await adminPage.getByRole('option', { name: JOB_PRIORITY_LABELS.hoch, exact: true }).click();
    await typeWorkCreatePlannedDate(createDialog, plannedDate.split('-').reverse().join(''));
    await typeIntoTimeInput(createDialog, 'job-time', '0815');
    await jobFormField(createDialog, 'duration').fill('2,5');
    await jobFormField(createDialog, 'location').fill(jobLocation);
    await employeeAssignmentPicker(createDialog).click();
    const employeeSearch = employeeAssignmentSearch(adminPage);
    await employeeSearch.fill(firstAssignee);
    await adminPage.getByRole('listbox').getByRole('option').filter({ hasText: firstAssignee }).click();
    await employeeSearch.fill(secondAssignee);
    await adminPage.getByRole('listbox').getByRole('option').filter({ hasText: secondAssignee }).click();
    await workCreateHeading(createDialog).click();
    await workCreateSubmit(createDialog, 'job').click();
    await expect(createDialog).toHaveCount(0, { timeout: 20_000 });

    await expect.poll(() => getJobCountByNumber(world.orgId, jobNumber)).toBe(1);
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const details = detailsRegion(adminPage);
    await expect(details).toContainText(jobNumber);
    await expect(details).toContainText(jobDescription);
    await expect(visibleText(adminPage, customerName)).toBeVisible();
    await expect(details).toContainText(JOB_PRIORITY_LABELS.hoch);
    await expect(details).toContainText(plannedDate.split('-').reverse().join('.'));
    await expect(details).toContainText('08:15');
    await expect(details).toContainText(formatDuration(150));
    await expect(details).toContainText(jobLocation);
    await expect(visibleText(adminPage, firstAssignee)).toBeVisible();
    await expect(visibleText(adminPage, secondAssignee)).toBeVisible();
    await expect(visibleText(adminPage, WORK_DETAIL_TEXT.noProject)).toBeVisible();
    await employeePage.goto('/auftraege');
    await expect(visibleText(employeePage, jobNumber)).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await adminPage.getByRole('button', { name: SHARED_COPY.assignment.assign, exact: true }).click();
    const assignmentDialog = projectJobAssignmentDialog(adminPage);
    await projectJobPicker(assignmentDialog).click();
    await adminPage.getByPlaceholder(SHARED_COPY.picker.searchJob).fill(jobNumber);
    await adminPage.getByRole('listbox').getByRole('option').filter({ hasText: jobNumber }).click();
    await dismissDialog(adminPage.getByRole('listbox'));
    await assignmentDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(assignmentDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(visibleText(adminPage, jobNumber)).toBeVisible();
    await expect(visibleText(adminPage, '0%')).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${jobNumber}`);
    await expect(visibleText(adminPage, projectNumber)).toBeVisible();
    await expect.poll(() => getJobProjectNumber(world.orgId, jobNumber)).toBe(projectNumber);
    await setJobStatus(adminPage, 'in_progress');
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleText(adminPage, PROJECT_STATUS_LABELS.in_bearbeitung)).toBeVisible();
    await expect(projectScheduleIndicators(adminPage)).not.toHaveCount(0);

    await lifecycleAction(adminPage, 'in_progress', 'cancelled').click();
    const cancelDialog = adminPage.getByRole('dialog');
    await cancelDialog
      .locator('#work-transition-reason')
      .fill('Projektstatus im Grundstock bewusst übersteuert.');
    await workTransitionSave(cancelDialog).click();
    await expectWorkTransitionSaved(adminPage, workTransitionActionLabel('in_progress', 'cancelled'));
    await expect(lifecycleState(adminPage, 'cancelled')).toBeVisible();
    const deriveDialog = await confirmLifecycleReason(
      adminPage,
      'deriveAutomatically',
      'Projekt folgt wieder den Aufträgen.',
    );
    await expect(deriveDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(lifecycleState(adminPage, 'in_progress')).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${projectNumber}/${jobNumber}`);
    await setJobStatus(adminPage, 'execution_complete');
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(visibleText(adminPage, PROJECT_STATUS_LABELS.abgeschlossen)).toBeVisible();
    await expect(visibleText(adminPage, '100%')).toBeVisible();
  });

  test('A1-10/A1-14: Kunden- und Projektlöschung erhalten die Arbeit', async ({ adminPage, world }) => {
    const customerName = `A1 Löschkunde ${world.runId}`;
    const linkedJobNumber = `A1-KD-${world.runId}`;
    const linkedProjectNumber = `A1-PD-${world.runId}`;
    await createCustomer(adminPage, customerName);
    await createProject(adminPage, {
      projectNumber: linkedProjectNumber,
      title: `A1 Kundenprojekt ${world.runId}`,
      clientName: customerName,
    });
    await createJob(adminPage, {
      jobNumber: linkedJobNumber,
      title: `A1 Kundenauftrag ${world.runId}`,
      projectNumber: linkedProjectNumber,
    });

    await adminPage.goto(`/auftraege/projekt/${linkedProjectNumber}`);
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();
    await expect(visibleText(adminPage, customerName)).toBeVisible();

    await openCustomerDetail(adminPage, customerName);
    await detailActionsButton(adminPage).click();
    const deleteCustomer = customerDeleteMenuItem(adminPage);
    await expect(deleteCustomer).toBeInViewport({ timeout: 5_000 });
    await deleteCustomer.click();
    const confirmCustomerDeletion = adminPage
      .getByRole('alertdialog')
      .getByRole('button', { name: SHARED_COPY.action.delete });
    await expectButtonTextContrast(adminPage, confirmCustomerDeletion);
    await confirmCustomerDeletion.click();
    await expect(adminPage).toHaveURL(/\/kunden$/, { timeout: 60_000 });
    await adminPage.goto('/auftraege');
    await expect(visibleText(adminPage, linkedProjectNumber)).toBeVisible();
    await expandProjectButton(adminPage.getByRole('row', { name: new RegExp(linkedProjectNumber) })).click();
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();

    await adminPage.goto(`/auftraege/projekt/${linkedProjectNumber}`);
    await detailActionsButton(adminPage).click();
    const deleteProject = projectDeleteMenuItem(adminPage);
    await expect(deleteProject).toBeInViewport({ timeout: 5_000 });
    await deleteProject.click();
    await adminPage.getByRole('alertdialog').getByRole('button', { name: SHARED_COPY.action.delete }).click();
    await expect(adminPage).toHaveURL((url) => url.pathname === '/auftraege', {
      timeout: 20_000,
    });
    await expect(visibleText(adminPage, linkedJobNumber)).toBeVisible();
    await adminPage.goto(`/auftraege/${linkedJobNumber}`);
    await expect(visibleText(adminPage, WORK_DETAIL_TEXT.noProject)).toBeVisible();
  });
});
