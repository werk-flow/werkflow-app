import { expect, test } from './support/fixtures';
import { getAppliedWorkTemplateState, getWorkTemplateStateByName } from './support/db';
import {
  createAndPublishWorkTemplate,
  createJob,
  createProject,
  inputByValue,
  setInstructionCompletionOnJobPage,
  visibleText,
} from './support/steps';

test.describe.configure({ mode: 'serial' });

test.describe('P1-13 versioned work templates @P1-13', () => {
  test('a manager publishes an immutable job template with unified checklist metadata', async ({
    adminPage,
    world,
  }) => {
    const name = `Wartung ${world.runId}`;
    await createAndPublishWorkTemplate(adminPage, {
      name,
      targetType: 'job',
      firstItem: 'Anlage prüfen',
      secondItem: 'Messwerte notieren',
      evidenceDescription: 'Foto der Messwerte',
    });
    const state = await getWorkTemplateStateByName(world.orgId, name);
    expect(state.template.target_type).toBe('job');
    expect(state.template.draft_version_id).toBeNull();
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0].status).toBe('published');
    expect(state.items.map((item) => item.content)).toEqual([
      'Anlage prüfen',
      'Messwerte notieren',
    ]);
    expect(state.items[1].requirement_state).toBe('optional');
    expect(state.evidence.map((item) => item.description)).toEqual(['Foto der Messwerte']);
    expect(state.dependencies).toHaveLength(1);
    expect(state.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['created', 'draft_saved', 'published'])
    );
  });

  test('creation materializes editable existing primitives without stock or schedule side effects', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const templateName = `Wartung ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P113-A`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await createJob(adminPage, {
      jobNumber,
      title: `Vorlagenauftrag ${world.runId}`,
      assignEmployeeName: employeeName,
      workTemplateName: templateName,
    });
    const state = await getAppliedWorkTemplateState(world.orgId, { jobNumber });
    expect(state.applications).toHaveLength(1);
    expect(state.instructions.map((item) => item.content)).toEqual([
      'Anlage prüfen',
      'Messwerte notieren',
    ]);
    expect(state.instructions.every((item) => item.work_template_application_id)).toBe(true);
    expect(state.inventoryMovements).toHaveLength(0);
    expect(state.planningOccurrences).toHaveLength(0);

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const instructionItem = employeePage
      .getByTestId('job-instruction-item')
      .filter({ hasText: 'Anlage prüfen' });
    await expect(instructionItem.getByText('Anlage prüfen', { exact: true })).toBeVisible();
    await expect(visibleText(employeePage, 'Nachweis erwartet: Foto der Messwerte')).toBeVisible();
    await setInstructionCompletionOnJobPage(employeePage, 'Anlage prüfen', true);
    await expect
      .poll(
        async () =>
          (await getAppliedWorkTemplateState(world.orgId, { jobNumber })).instructions[0]
            .is_completed,
        { timeout: 20_000 }
      )
      .toBe(true);
    await employeePage.reload();
    const completedInstruction = employeePage
      .getByTestId('job-instruction-item')
      .filter({ hasText: 'Anlage prüfen' });
    await expect(
      completedInstruction.getByRole('button', {
        name: 'Punkt als offen markieren',
      })
    ).toBeVisible();
  });

  test('a newer template version changes only future applications', async ({
    adminPage,
    world,
  }) => {
    const name = `Wartung ${world.runId}`;
    await adminPage.goto('/arbeitsvorlagen');
    await adminPage.getByRole('textbox', { name: 'Arbeitsvorlagen suchen' }).fill(name);
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    let editor = adminPage.getByRole('dialog');
    await editor.getByRole('button', { name: 'Neue Version' }).click();
    await expect(editor).toHaveCount(0, { timeout: 15_000 });
    await adminPage.getByRole('button', { name: 'Öffnen', exact: true }).click();
    editor = adminPage.getByRole('dialog');
    await (
      await inputByValue(editor, 'Bezeichnung', 'Anlage prüfen')
    ).fill('Anlage vollständig prüfen');
    await editor.getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(editor).toHaveCount(0, { timeout: 20_000 });

    const templateState = await getWorkTemplateStateByName(world.orgId, name);
    expect(templateState.versions.map((version) => version.version_number)).toEqual([1, 2]);
    const firstJob = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: `AUF-${world.runId}-P113-A`,
    });
    expect(firstJob.instructions.map((item) => item.content)).toContain('Anlage prüfen');
    expect(firstJob.instructions.map((item) => item.content)).not.toContain(
      'Anlage vollständig prüfen'
    );

    const nextNumber = `AUF-${world.runId}-P113-B`;
    await createJob(adminPage, {
      jobNumber: nextNumber,
      title: `Neue Version ${world.runId}`,
      workTemplateName: name,
    });
    const nextJob = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber: nextNumber,
    });
    expect(nextJob.instructions.map((item) => item.content)).toContain('Anlage vollständig prüfen');
  });

  test('project templates create direct project planning and employees cannot manage templates', async ({
    adminPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    const name = `Sanierung ${world.runId}`;
    await createAndPublishWorkTemplate(adminPage, {
      name,
      targetType: 'project',
      firstItem: 'Baustelle vorbereiten',
    });
    const projectNumber = `PRJ-${world.runId}-P113`;
    await createProject(adminPage, {
      projectNumber,
      title: `Vorlagenprojekt ${world.runId}`,
      workTemplateName: name,
    });
    const state = await getAppliedWorkTemplateState(world.orgId, {
      projectNumber,
    });
    expect(state.applications).toHaveLength(1);
    expect(state.instructions.map((item) => item.content)).toEqual(['Baustelle vorbereiten']);
    expect(state.instructions[0].work_template_application_id).not.toBeNull();

    await employeePage.goto('/arbeitsvorlagen');
    await expect(employeePage).toHaveURL(/\/dashboard/);
    await outsiderPage.goto('/arbeitsvorlagen');
    const outsiderMain = outsiderPage.getByRole('main');
    await expect(
      outsiderMain.getByText('Erste Arbeitsvorlage anlegen', { exact: true })
    ).toBeVisible();
    await expect(outsiderMain.getByText(name, { exact: true })).toHaveCount(0);
  });
});
