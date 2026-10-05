import type { Page } from '@playwright/test';

import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import {
  beginWorkArtifact,
  fillWorkArtifactVisit,
  submitWorkArtifactAndClose,
  workArtifactField,
} from './support/spec-helpers/work-artifact-dialog';
import { expect, test } from './support/fixtures';
import { seedCustomer } from './support/db/customers';
import {
  getMaintenanceCoverageStateByReference,
  getMaintenancePlanNumberByClient,
  getMaintenanceStateByPlanNumber,
  seedInstalledEquipment,
} from './support/db/service';
import { getJobNumberById, seedPublishedWorkTemplate } from './support/db/work';
import { ownedBerlinDateAtOffset } from './support/date-ownership';
import {
  createMaintenanceCoverageViaDialog,
  createMaintenancePlanViaDialog,
  maintenanceDueEvidence,
  maintenanceDueRow,
  maintenanceDueRowAction,
  maintenanceDueSubmit,
  maintenanceRenewalSignal,
  maintenanceSearchUrl,
  recordCoverageFollowUp,
} from './support/steps/service';
import {
  SHARED_COPY,
  employeeAssignmentHeading,
  employeeAssignmentPicker,
  employeeAssignmentSearch,
  openEmployeeAssignmentDialog,
  testData,
} from './support/steps/shared';
import { openFieldWorkPack } from './support/steps/work';

async function createSubmittedReport(page: Page, title: string, visitDate: string): Promise<void> {
  const dialog = await beginWorkArtifact(page, {
    kind: 'work_report',
    title,
    summary: 'Wartungsumfang nachvollziehbar dokumentiert.',
  });
  await fillWorkArtifactVisit(dialog, { date: visitDate, from: '06:00', to: '08:00' });
  await workArtifactField(dialog, 'performedWork').fill('Anlage geprüft und Messwerte dokumentiert.');
  await submitWorkArtifactAndClose(dialog);
}

async function assignEmployee(page: Page, jobNumber: string, employeeName: string): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const dialog = await openEmployeeAssignmentDialog(page);
  await employeeAssignmentPicker(dialog).click();
  await employeeAssignmentSearch(page).fill(employeeName);
  await page.getByRole('listbox').getByRole('option').filter({ hasText: employeeName }).click();
  await employeeAssignmentHeading(dialog).click();
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('main').getByRole('link', { name: employeeName, exact: true })).toBeVisible();
}

test.describe('P1-20 maintenance plan to completed visit @P1-20 @GG-06', () => {
  test('plans maintenance and completes the first visit with exact evidence @P1-20-journey', async ({
    adminPage,
    employeePage,
    world,
    businessDate,
  }) => {
    const names = {
      customer: testData`P120 Golden Kunde ${world.runId}`,
      site: testData`P120 Golden Heizzentrale ${world.runId}`,
      equipment: testData`P120 Golden Wärmeerzeuger ${world.runId}`,
      template: testData`P120 Golden Wartung ${world.runId}`,
      coverageReference: testData`P120-VERTRAG-${world.runId}`,
      evidenceTitle: testData`P120 Golden Wartungsbericht ${world.runId}`,
      employee: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    };
    const operationalNotePrefix = testData`Leistungsumfang vor Verlängerung`;
    const instructionsFragment = testData`Messwerte vollständig erfassen`;
    // Completion is bounded by the operating date, so the first visit is due on
    // the business date while the coverage dates keep P1-20's owned window.
    const firstDueLabel = new Intl.DateTimeFormat('de-DE').format(new Date(`${businessDate}T12:00:00Z`));

    const clientId = await test.step('Seed the customer site, equipment and published template', async () => {
      const customer = await seedCustomer({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        name: names.customer,
        sites: [
          {
            name: names.site,
            street: 'Wartungsweg 20',
            postalCode: '10115',
            city: 'Berlin',
            isPrimary: true,
          },
        ],
      });
      await seedInstalledEquipment({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        clientId: customer.clientId,
        siteId: expectDefined(customer.siteIds.get(names.site), 'the seeded P1-20 site'),
        name: names.equipment,
        manufacturer: 'WerkFlow Testtechnik',
        model: 'MW 20',
      });
      await seedPublishedWorkTemplate({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        name: names.template,
        targetType: 'job',
        items: [
          { content: 'Anlage warten' },
          { content: 'Messwerte dokumentieren', evidenceDescription: 'Wartungsbericht' },
        ],
      });
      return customer.clientId;
    });

    await test.step('Record the operational coverage and its follow-up', async () => {
      const validFrom = ownedBerlinDateAtOffset('p1-20', 105);
      const reviewDueDate = ownedBerlinDateAtOffset('p1-20', 106);
      const validUntil = ownedBerlinDateAtOffset('p1-20', 109);
      await createMaintenanceCoverageViaDialog(adminPage, {
        clientName: names.customer,
        siteName: names.site,
        reference: names.coverageReference,
        validFrom,
        validUntil,
        noticeDate: ownedBerlinDateAtOffset('p1-20', 107),
        renewalDate: ownedBerlinDateAtOffset('p1-20', 108),
        reviewDueDate,
        operationalNote: `${operationalNotePrefix} intern prüfen.`,
      });
      await expect(maintenanceRenewalSignal(adminPage, 'scheduled')).toBeVisible();
      await recordCoverageFollowUp(adminPage, names.coverageReference);

      const state = expectDefined(
        await getMaintenanceCoverageStateByReference(world.orgId, names.coverageReference),
        'the recorded coverage',
      );
      expect(state.coverage).toMatchObject({
        valid_from: validFrom,
        valid_until: validUntil,
        review_due_date: reviewDueDate,
        status: 'active',
      });
      expect(state.events.map((event) => event.event_type)).toContain('created');
      expect(state.followUps).toHaveLength(1);
    });

    const planNumber = await test.step('Activate a versioned plan and materialize its horizon', async () => {
      await createMaintenancePlanViaDialog(adminPage, {
        clientName: names.customer,
        siteName: names.site,
        coverageReference: names.coverageReference,
        templateName: names.template,
        equipmentName: names.equipment,
        effectiveFrom: businessDate,
        firstDue: businessDate,
        intervalMonths: '6',
        instructions: `Zugang über das Büro; ${instructionsFragment}.`,
      });
      const activeNumber = expectDefined(
        await getMaintenancePlanNumberByClient(world.orgId, clientId),
        'the activated plan',
      );
      const state = expectDefined(
        await getMaintenanceStateByPlanNumber(world.orgId, activeNumber),
        'plan state',
      );
      expect(state.plan.status).toBe('active');
      expect(state.revisions).toHaveLength(1);
      expect(state.equipment).toHaveLength(1);
      expect(state.dueWork.length).toBeGreaterThanOrEqual(3);
      expect(state.dueWork[0]).toMatchObject({
        due_date: businessDate,
        status: 'open',
        job_id: null,
        planning_occurrence_id: null,
      });
      expect(state.planEvents.map((event) => event.event_type)).toEqual(
        expect.arrayContaining(['created', 'horizon_extended']),
      );
      return activeNumber;
    });

    const jobNumber = await test.step('Create and schedule one normal visit job', async () => {
      const dueRow = maintenanceDueRow(adminPage, planNumber, firstDueLabel);
      // The due list pages; the search puts this plan's items on the first page.
      await adminPage.goto(maintenanceSearchUrl(planNumber));
      await maintenanceDueRowAction(dueRow, 'createJob').click();
      let dialog = adminPage.getByRole('dialog');
      await maintenanceDueSubmit(dialog).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      const created = expectDefined(
        await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
        'plan state',
      );
      const linkedDue = expectDefined(created.dueWork[0], 'the first due item');
      expect(linkedDue.status).toBe('visit_created');
      const jobId = expectDefined(linkedDue.job_id, 'the visit job');

      await adminPage.goto(maintenanceSearchUrl(planNumber));
      await maintenanceDueRowAction(dueRow, 'schedule').click();
      dialog = adminPage.getByRole('dialog');
      await maintenanceDueSubmit(dialog).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      const scheduled = expectDefined(
        await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
        'plan state',
      );
      expect(scheduled.dueWork[0]?.planning_occurrence_id).not.toBeNull();
      return expectDefined(await getJobNumberById(world.orgId, jobId), 'the visit job number');
    });

    await test.step('Show the assigned employee only the exact visit context', async () => {
      await assignEmployee(adminPage, jobNumber, names.employee);
      const pack = await openFieldWorkPack(employeePage, jobNumber);
      await expect(pack).toContainText(planNumber);
      await expect(pack).toContainText(names.equipment);
      await expect(pack).toContainText(instructionsFragment);
      await expect(pack).not.toContainText(names.coverageReference);
      await expect(pack).not.toContainText(operationalNotePrefix);

      await employeePage.goto(`/auftraege/${jobNumber}`);
      await createSubmittedReport(employeePage, names.evidenceTitle, businessDate);
    });

    await test.step('Complete the due item with the exact evidence and next due', async () => {
      await adminPage.goto(maintenanceSearchUrl(planNumber));
      const dueRow = maintenanceDueRow(adminPage, planNumber, firstDueLabel);
      await maintenanceDueRowAction(dueRow, 'complete').click();
      const dialog = adminPage.getByRole('dialog');
      await maintenanceDueEvidence(dialog, names.evidenceTitle).click();
      await maintenanceDueSubmit(dialog).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      const state = expectDefined(
        await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
        'plan state',
      );
      expect(state.dueWork[0]).toMatchObject({
        status: 'completed',
        scope_outcome: 'complete',
        completed_on: expect.any(String),
        next_due_date: expect.any(String),
      });
      expect(state.evidenceLinks).toHaveLength(1);
      expect(state.dueEvents.map((event) => event.event_type)).toContain('completed');
    });
  });
});
