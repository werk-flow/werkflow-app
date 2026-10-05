import { expect, test } from './support/fixtures';
import { getAppliedWorkTemplateState, getWorkTemplateStateByName } from './support/db/work';
import { inputByValue, SHARED_COPY, testData, visibleText } from './support/steps/shared';
import {
  createAndPublishWorkTemplate,
  createJob,
  instructionEvidenceExpectation,
  jobInstructionItem,
  jobInstructionLabel,
  jobInstructionToggle,
  setInstructionCompletionOnJobPage,
  workTemplateEditorAction,
  workTemplateOpenButton,
  workTemplateSearch,
} from './support/steps/work';

// supabase/tests/p1_13_work_templates.sql owns immutability, snapshot side
// effects, retired references and the read boundaries; this journey proves
// what the manager and the field worker see.
test.describe('P1-13 versioned work templates @P1-13', () => {
  test('a manager publishes a template, creates work from it, and a new version reaches only future work', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const name = `Wartung ${world.runId}`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const firstJobNumber = `AUF-${world.runId}-P113-A`;
    const nextJobNumber = `AUF-${world.runId}-P113-B`;
    const checkPoint = testData`Anlage prüfen`;
    const changedCheckPoint = testData`Anlage vollständig prüfen`;
    const evidenceDescription = testData`Foto der Messwerte`;

    await test.step('Publish a job template with an optional checklist point and an evidence expectation', async () => {
      await createAndPublishWorkTemplate(adminPage, {
        name,
        targetType: 'job',
        firstItem: checkPoint,
        secondItem: 'Messwerte notieren',
        evidenceDescription,
      });
      const state = await getWorkTemplateStateByName(world.orgId, name);
      expect(state.versions.map((version) => version.status)).toEqual(['published']);
      expect(state.items.map((item) => [item.content, item.requirement_state])).toEqual([
        ['Anlage prüfen', 'required'],
        ['Messwerte notieren', 'optional'],
      ]);
    });

    await test.step('Create an assigned job from the template', async () => {
      await createJob(adminPage, {
        jobNumber: firstJobNumber,
        title: `Vorlagenauftrag ${world.runId}`,
        assignEmployeeName: employeeName,
        workTemplateName: name,
      });
      const state = await getAppliedWorkTemplateState(world.orgId, { jobNumber: firstJobNumber });
      expect(state.applications).toHaveLength(1);
      expect(state.instructions.map((item) => item.content)).toEqual(['Anlage prüfen', 'Messwerte notieren']);
    });

    await test.step('The field worker sees the snapshot and completes a point', async () => {
      await employeePage.goto(`/auftraege/${firstJobNumber}`);
      const instructionItem = jobInstructionItem(employeePage, checkPoint);
      await expect(jobInstructionLabel(instructionItem, checkPoint)).toBeVisible();
      await expect(instructionEvidenceExpectation(employeePage, evidenceDescription)).toBeVisible();
      await setInstructionCompletionOnJobPage(employeePage, checkPoint, true);
      await expect
        .poll(
          async () =>
            (await getAppliedWorkTemplateState(world.orgId, { jobNumber: firstJobNumber })).instructions.find(
              (item) => item.content === 'Anlage prüfen',
            )?.is_completed,
          { timeout: 20_000 },
        )
        .toBe(true);
      await employeePage.reload();
      await expect(jobInstructionToggle(jobInstructionItem(employeePage, checkPoint), 'open')).toBeVisible();
    });

    await test.step('Publish version 2 with a changed point', async () => {
      await adminPage.goto('/arbeitsvorlagen');
      await workTemplateSearch(adminPage).fill(name);
      await workTemplateOpenButton(adminPage).click();
      let editor = adminPage.getByRole('dialog');
      await workTemplateEditorAction(editor, 'newVersion').click();
      await expect(editor).toHaveCount(0, { timeout: 15_000 });
      await workTemplateOpenButton(adminPage).click();
      editor = adminPage.getByRole('dialog');
      await (await inputByValue(editor, SHARED_COPY.field.name, checkPoint)).fill(changedCheckPoint);
      await workTemplateEditorAction(editor, 'publish').click();
      await expect(editor).toHaveCount(0, { timeout: 20_000 });
      const state = await getWorkTemplateStateByName(world.orgId, name);
      expect(state.versions.map((version) => [version.version_number, version.status])).toEqual([
        [1, 'published'],
        [2, 'published'],
      ]);
    });

    await test.step('Existing work keeps version 1 and new work receives version 2', async () => {
      await employeePage.goto(`/auftraege/${firstJobNumber}`);
      await expect(visibleText(employeePage, checkPoint, true)).toBeVisible();
      await expect(employeePage.getByRole('main').getByText(changedCheckPoint)).toHaveCount(0);

      await createJob(adminPage, {
        jobNumber: nextJobNumber,
        title: `Neue Version ${world.runId}`,
        workTemplateName: name,
      });
      const nextJob = await getAppliedWorkTemplateState(world.orgId, { jobNumber: nextJobNumber });
      expect(nextJob.instructions.map((item) => item.content)).toEqual([
        'Anlage vollständig prüfen',
        'Messwerte notieren',
      ]);
    });
  });
});
