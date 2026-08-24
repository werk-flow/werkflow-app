import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/fixtures';
import { getVisibleWorkArtifactCountsAs, getWorkArtifactState, getWorkLifecycleState } from './support/db';
import { createJob, typeIntoDatePickerById, typeIntoDateTimeField } from './support/steps';

test.describe.configure({ mode: 'serial' });

function futureDate(days: number): string {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

async function selectOption(page: Page, trigger: Locator, name: string): Promise<void> {
  await trigger.click();
  const option = page.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

async function openNew(page: Page, kind: string, title: string): Promise<Locator> {
  await page.getByTestId('work-artifacts-section').getByRole('button', { name: 'Neu' }).click();
  const dialog = page.getByRole('dialog');
  await selectOption(page, dialog.getByRole('combobox', { name: 'Art des Arbeitsnachweises' }), kind);
  await dialog.getByLabel('Titel').fill(title);
  await dialog.getByLabel('Zusammenfassung').fill(`Golden-Nachweis ${title}`);
  return dialog;
}

test.describe('P1-15 structured site evidence @P1-15', () => {
  test('roles, immutable approval, structured measurement, lifecycle projection, and RLS', async ({
    adminPage, employeePage, outsiderPage, world,
  }) => {
    test.setTimeout(300_000);
    const jobNumber = `AUF-${world.runId}-P115-GOLDEN`;
    const title = `Golden Arbeitsbericht ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title: `Golden Nachweisauftrag ${world.runId}`,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await employeePage.goto(`/auftraege/${jobNumber}`);
    const dialog = await openNew(employeePage, 'Arbeitsbericht', title);
    await typeIntoDateTimeField(dialog, 'artifact-visit-start', `${futureDate(1)}T08:00`);
    await typeIntoDateTimeField(dialog, 'artifact-visit-end', `${futureDate(1)}T09:30`);
    await dialog.getByLabel('Ausgeführte Arbeiten').fill('Sicherheitsventil geprüft und Anlage entlüftet.');
    await dialog.getByRole('button', { name: 'Zur Prüfung einreichen', exact: true }).click();
    await expect(dialog.getByText(/Version 1/)).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('button', { name: 'Intern freigeben' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Schließen' }).first().click();

    await expect.poll(async () => (await getWorkArtifactState(world.orgId, { jobNumber })).artifacts.length).toBe(1);

    await adminPage.goto(`/auftraege/${jobNumber}?golden=${Date.now()}`);
    await expect(adminPage.getByTestId('work-artifacts-section')).toContainText(title, { timeout: 30_000 });
    await adminPage.getByText(title, { exact: true }).click();
    const adminDialog = adminPage.getByRole('dialog');
    await adminDialog.getByRole('button', { name: 'Intern freigeben' }).click();
    await expect(adminDialog.getByText('Intern freigegeben', { exact: false })).toBeVisible({ timeout: 20_000 });
    const state = await getWorkArtifactState(world.orgId, { jobNumber });
    expect(state.artifacts[0]).toMatchObject({ kind: 'work_report', status: 'approved', version: 2 });
    expect(state.revisions).toHaveLength(1);
    expect(state.actions.map((action) => action.action_type)).toEqual(['review_requested', 'internal_approved']);
    expect(state.actions[1].responsibility_snapshot).toMatchObject({ responsibility: 'work_artifact_approval' });
    await adminDialog.getByRole('button', { name: 'Schließen' }).first().click();

    const measurementTitle = `Golden Aufmaß ${world.runId}`;
    const measurementDialog = await openNew(adminPage, 'Aufmaß', measurementTitle);
    await typeIntoDatePickerById(measurementDialog, 'artifact-measurement-date', futureDate(2));
    await measurementDialog.getByLabel('Aufmaßort').fill('Technikzentrale');
    await measurementDialog.getByRole('button', { name: 'Position ergänzen' }).click();
    await measurementDialog.getByLabel('Bezeichnung').fill('Heizungsrohr');
    await measurementDialog.locator('#artifact-measurement-quantity-0').fill('7,25');
    await selectOption(adminPage, measurementDialog.getByRole('combobox', { name: 'Aufmaßeinheit' }), 'm');
    await measurementDialog.getByLabel('Ort', { exact: true }).fill('Achse B');
    await measurementDialog.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
    await expect(measurementDialog.getByText(/Aufmaß · Entwurf · Version 1/)).toBeVisible({ timeout: 20_000 });
    const measurementState = await getWorkArtifactState(world.orgId, { jobNumber });
    expect(measurementState.measurements).toHaveLength(1);
    expect(Number(measurementState.measurements[0].quantity)).toBe(7.25);
    expect(measurementState.measurements[0].unit).toBe('meter');
    const lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(lifecycle.snapshot.gates.measurementArtifacts).toBe(1);
    expect(lifecycle.snapshot.gates.notAssessable).not.toContain('measurements');

    const counts = await getVisibleWorkArtifactCountsAs(world.outsider.admin, world.orgId);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    await outsiderPage.goto(`/auftraege/${jobNumber}`);
    await expect(outsiderPage.getByTestId('work-artifacts-section')).toHaveCount(0);
  });
});
