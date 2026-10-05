import { expect, test } from './support/fixtures';
import { berlinDateAtOffset } from './support/date-ownership';
import { getWorkArtifactState } from './support/db/work';
import {
  beginWorkArtifact,
  closeWorkArtifactDialog,
  workArtifactAction,
  workArtifactDescription,
  workArtifactDialog,
  workArtifactEntry,
  workArtifactField,
  workArtifactsSection,
  workArtifactStatusText,
  workArtifactVersion,
  selectWorkArtifactUnit,
  fillWorkArtifactVisit,
} from './support/spec-helpers/work-artifact-dialog';
import { typeIntoDatePickerById } from './support/steps/shared';
import { createJob } from './support/steps/work';

// The other kinds, stale writes, review outcomes, customer outcomes and the
// lifecycle projection are edge cases in tests/audit/wave-2/p1-15.spec.ts; the
// organization boundary is in supabase/tests/work_execution_boundaries.sql.
test.describe('P1-15 structured site evidence @P1-15', () => {
  test('a field worker submits a work report, a second person approves it, and a measurement is recorded', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P115-GOLDEN`;
    const title = `Golden Arbeitsbericht ${world.runId}`;
    const measurementTitle = `Golden Aufmaß ${world.runId}`;

    await test.step('The assigned field worker submits a work report for review', async () => {
      await createJob(adminPage, {
        jobNumber,
        title: `Golden Nachweisauftrag ${world.runId}`,
        assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      });
      const visitDate = berlinDateAtOffset(1);
      await employeePage.goto(`/auftraege/${jobNumber}`);
      const dialog = await beginWorkArtifact(employeePage, {
        kind: 'work_report',
        title,
        summary: `Golden-Nachweis ${title}`,
      });
      await fillWorkArtifactVisit(dialog, { date: visitDate, from: '08:00', to: '09:30' });
      await workArtifactField(dialog, 'performedWork').fill(
        'Sicherheitsventil geprüft und Anlage entlüftet.',
      );
      await workArtifactAction(dialog, 'submitForReview').click();
      await expect(workArtifactVersion(dialog, 1)).toBeVisible({
        timeout: 20_000,
      });
      await expect(workArtifactAction(dialog, 'approveInternally')).toHaveCount(0);
      await closeWorkArtifactDialog(dialog);
      await expect
        .poll(async () =>
          (await getWorkArtifactState(world.orgId, { jobNumber })).artifacts.map((row) => row.status),
        )
        .toEqual(['submitted']);
    });

    await test.step('A second person approves the report internally', async () => {
      await adminPage.goto(`/auftraege/${jobNumber}`);
      await expect(workArtifactsSection(adminPage)).toContainText(title, {
        timeout: 30_000,
      });
      await workArtifactEntry(adminPage, title).click();
      const adminDialog = workArtifactDialog(adminPage);
      await workArtifactAction(adminDialog, 'approveInternally').click();
      await expect(workArtifactStatusText(adminDialog, 'approved')).toBeVisible({
        timeout: 20_000,
      });
      await closeWorkArtifactDialog(adminDialog);
      const state = await getWorkArtifactState(world.orgId, { jobNumber });
      expect(state.artifacts[0]).toMatchObject({
        kind: 'work_report',
        status: 'approved',
        version: 2,
      });
      expect(state.actions.map((action) => [action.action_type, action.created_by])).toEqual([
        ['review_requested', world.users.employee.id],
        ['internal_approved', world.users.admin.id],
      ]);
    });

    await test.step('The manager records a structured measurement', async () => {
      const measurementDialog = await beginWorkArtifact(adminPage, {
        kind: 'measurement',
        title: measurementTitle,
        summary: `Golden-Nachweis ${measurementTitle}`,
      });
      await typeIntoDatePickerById(measurementDialog, 'artifact-measurement-date', berlinDateAtOffset(2));
      await workArtifactField(measurementDialog, 'measurementLocation').fill('Technikzentrale');
      await workArtifactAction(measurementDialog, 'addMeasurementLine').click();
      await workArtifactField(measurementDialog, 'lineName').fill('Heizungsrohr');
      await measurementDialog.locator('#artifact-measurement-quantity-0').fill('7,25');
      await selectWorkArtifactUnit(adminPage, measurementDialog, 'meter');
      await workArtifactField(measurementDialog, 'location').fill('Achse B');
      await workArtifactAction(measurementDialog, 'saveDraft').click();
      await expect(workArtifactDescription(measurementDialog, 'measurement', 'draft', 1)).toBeVisible({
        timeout: 20_000,
      });
      const state = await getWorkArtifactState(world.orgId, { jobNumber });
      expect(state.measurements).toHaveLength(1);
      expect(Number(state.measurements[0]?.quantity)).toBe(7.25);
      expect(state.measurements[0]?.unit).toBe('meter');
    });
  });
});
