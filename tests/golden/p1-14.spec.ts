import { expect, test } from './support/fixtures';
import { getWorkLifecycleState } from './support/db/work';
import { clockInOnJob, clockOut } from './support/steps/time-tracking';
import {
  addWorkBlocker,
  confirmLifecycleReason,
  createJob,
  lifecycleCardActionName,
  lifecycleNextStep,
  lifecycleState,
  workLifecycleCard,
} from './support/steps/work';

// Manager transitions, parking, prerequisites, gates and project overrides are
// edge cases in tests/audit/wave-2/p1-14.spec.ts; ledger side effects and the
// organization boundary are in supabase/tests/work_execution_boundaries.sql.
test.describe('P1-14 work lifecycle @P1-14', () => {
  test('an assigned field worker reports and resolves an own blocker and starts work by clocking in', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const jobNumber = `AUF-${world.runId}-P114`;
    const title = `Lifecycle ${world.runId}`;

    await test.step('The assigned job shows its state and the next step', async () => {
      await createJob(adminPage, {
        jobNumber,
        title,
        assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      });
      await employeePage.goto(`/auftraege/${jobNumber}`);
      await expect(lifecycleState(employeePage, 'not_started')).toBeVisible();
      await expect(lifecycleNextStep(employeePage, 'not_started')).toBeVisible();
    });

    await test.step('The field worker reports an own blocker without manager controls', async () => {
      const dialog = await addWorkBlocker(employeePage, {
        reason: 'site_access',
        details: 'Schlüssel fehlt am vereinbarten Ort.',
      });
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
      await expect(lifecycleNextStep(employeePage, 'not_started', 'blocker')).toBeVisible();
      await expect(
        workLifecycleCard(employeePage).getByRole('button', { name: lifecycleCardActionName('park') }),
      ).toHaveCount(0);
      const state = await getWorkLifecycleState(world.orgId, { jobNumber });
      expect(state.blockers).toEqual([
        expect.objectContaining({ kind: 'blocker', reason: 'site_access', state: 'open', version: 1 }),
      ]);
    });

    await test.step('The field worker resolves the blocker with a note', async () => {
      const dialog = await confirmLifecycleReason(
        employeePage,
        'resolveBlocker',
        'Schlüssel wurde übergeben.',
      );
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(async () => (await getWorkLifecycleState(world.orgId, { jobNumber })).blockers[0]?.state)
        .toBe('resolved');
      const state = await getWorkLifecycleState(world.orgId, { jobNumber });
      expect(state.blockers[0]).toMatchObject({
        version: 2,
        resolution_note: 'Schlüssel wurde übergeben.',
      });
    });
    await test.step('Clocking in moves the job into execution', async () => {
      await clockInOnJob(employeePage, title);
      await expect
        .poll(async () => {
          const entity = (await getWorkLifecycleState(world.orgId, { jobNumber })).entity;
          return 'execution_state' in entity ? entity.execution_state : null;
        })
        .toBe('in_progress');
      await clockOut(employeePage);
      const state = await getWorkLifecycleState(world.orgId, { jobNumber });
      expect(state.executionEvents.map((event) => [event.event_type, event.to_state])).toEqual([
        ['automatic_time_start', 'in_progress'],
      ]);
    });
  });
});
