import { expect, test } from './support/fixtures';
import { getVisibleWorkLifecycleCountsAs, getWorkLifecycleState } from './support/db';
import {
  clockInOnJob,
  clockOut,
  createJob,
  createProject,
  selectFromSearchable,
  typeIntoDatePickerById,
} from './support/steps';

test.describe.configure({ mode: 'serial' });

function tomorrowIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.now() + 86_400_000));
}

test.describe('P1-14 work lifecycle @P1-14', () => {
  test('time start moves assigned work atomically into execution', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P114-TIME`;
    const title = `Lifecycle Zeitstart ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const card = employeePage.getByTestId('work-lifecycle-card');
    await expect(card.getByText('Nicht begonnen', { exact: true })).toBeVisible();
    await expect(card.getByText('Nächster Schritt: Arbeit starten')).toBeVisible();

    await clockInOnJob(employeePage, title);
    await expect
      .poll(async () => {
        const entity = (await getWorkLifecycleState(world.orgId, { jobNumber })).entity;
        return 'execution_state' in entity ? entity.execution_state : null;
      })
      .toBe('in_progress');
    await clockOut(employeePage);

    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.executionEvents.at(-1)).toMatchObject({
      event_type: 'automatic_time_start',
      from_state: 'not_started',
      to_state: 'in_progress',
      previous_version: 0,
      resulting_version: 1,
    });
  });

  test('an employee reports and resolves an owned blocker without receiving manager controls', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P114-BLOCK`;
    await createJob(adminPage, {
      jobNumber,
      title: `Lifecycle Blocker ${world.runId}`,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await employeePage.goto(`/auftraege/${jobNumber}`);
    const card = employeePage.getByTestId('work-lifecycle-card');
    await card.getByRole('button', { name: 'Blocker', exact: true }).click();
    const dialog = employeePage.getByRole('dialog');
    await dialog.locator('#work-blocker-reason').click();
    await employeePage.getByRole('option', { name: 'Zugang zum Einsatzort' }).click();
    await dialog.locator('#work-blocker-details').fill('Schlüssel fehlt am vereinbarten Ort.');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    let state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.blockers).toHaveLength(1);
    expect(state.blockers[0]).toMatchObject({
      kind: 'blocker',
      reason: 'site_access',
      state: 'open',
      version: 1,
    });
    await expect(card.getByText('Offene Blocker klären', { exact: false })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Parken' })).toHaveCount(0);

    await card.getByRole('button', { name: 'Lösen' }).click();
    await employeePage
      .getByRole('dialog')
      .locator('#work-reason')
      .fill('Schlüssel wurde übergeben.');
    await employeePage.getByRole('dialog').getByRole('button', { name: 'Lösen' }).click();
    await expect
      .poll(
        async () => (await getWorkLifecycleState(world.orgId, { jobNumber })).blockers[0]?.state
      )
      .toBe('resolved');
    state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.blockers[0]).toMatchObject({
      version: 2,
      resolution_note: 'Schlüssel wurde übergeben.',
    });
  });

  test('manager parking carries intent and remains separate from execution', async ({
    adminPage,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P114-PARK`;
    await createJob(adminPage, {
      jobNumber,
      title: `Lifecycle Parkplatz ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const card = adminPage.getByTestId('work-lifecycle-card');
    await card.getByRole('button', { name: 'Parken', exact: true }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.locator('#work-blocker-reason').click();
    await adminPage.getByRole('option', { name: 'Material', exact: true }).click();
    await dialog.locator('#work-blocker-details').fill('Liefertermin beim Großhandel klären.');
    await selectFromSearchable(
      adminPage,
      dialog.locator('#work-blocker-owner'),
      world.users.admin.firstName
    );
    await typeIntoDatePickerById(dialog, 'work-blocker-review', tomorrowIso());
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.entity).toMatchObject({
      execution_state: 'not_started',
      status: 'geparkt',
    });
    expect(state.blockers[0]).toMatchObject({
      kind: 'parking',
      reason: 'material',
      state: 'open',
    });
    await expect(
      card.locator('[data-slot="badge"]').getByText('Geparkt', { exact: true })
    ).toBeVisible();
    await expect(card.getByText('Nicht begonnen', { exact: true })).toBeVisible();
  });

  test('project overrides are reasoned, versioned, reversible, and organization-isolated', async ({
    adminPage,
    outsiderPage,
    world,
  }) => {
    const projectNumber = `PRJ-${world.runId}-P114`;
    await createProject(adminPage, {
      projectNumber,
      title: `Lifecycle Projekt ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    const card = adminPage.getByTestId('work-lifecycle-card');
    await expect(card.getByText('Automatisch abgeleitet', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Storniert', exact: true }).click();
    let dialog = adminPage.getByRole('dialog');
    await dialog.locator('#work-transition-reason').fill('Projekt wurde vom Auftraggeber beendet.');
    await dialog.getByRole('button', { name: 'Änderung speichern' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    let state = await getWorkLifecycleState(world.orgId, { projectNumber });
    expect(state.entity).toMatchObject({
      execution_state_override: 'cancelled',
      execution_version: 1,
    });
    expect(state.executionEvents.at(-1)?.reason).toBe('Projekt wurde vom Auftraggeber beendet.');

    await card.getByRole('button', { name: 'Automatisch ableiten' }).click();
    dialog = adminPage.getByRole('dialog');
    await dialog.locator('#work-reason').fill('Projekt folgt wieder den Aufträgen.');
    await dialog.getByRole('button', { name: 'Automatisch ableiten' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    state = await getWorkLifecycleState(world.orgId, { projectNumber });
    expect(state.entity).toMatchObject({
      execution_state_override: null,
      execution_version: 2,
    });
    expect(state.executionEvents.at(-1)?.event_type).toBe('override_cleared');

    await outsiderPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(outsiderPage.getByTestId('work-lifecycle-card')).toHaveCount(0);
    const outsiderCounts = await getVisibleWorkLifecycleCountsAs(world.outsider.admin, world.orgId);
    expect(Object.values(outsiderCounts).every((count) => count === 0)).toBe(true);
  });
});
