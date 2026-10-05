import { expect, test } from '../support/fixtures';
import { getTimeCaptureState } from '../../golden/support/db/time-tracking';
import {
  activityKindButton,
  chooseActivityJob,
  chooseStandbyContext,
  chooseTravelQualifiers,
  clockOut,
  openFullActivityDialog,
} from '../../golden/support/steps/time-tracking';
import { createJob } from '../../golden/support/steps/work';

// Golden P1-21 walks the start, every activity switch and the clock-out. This
// audit keeps the qualifiers only the full activity dialog offers. Job
// execution start, tenant isolation and the transition arithmetic are proven in
// supabase/tests/p1_21_time_segments.sql.

test.describe('P1-21 activity qualifier audit @AUDIT-W2-P1-21 @AUDIT-W2', () => {
  test('records a job-linked travel route and role, then a standby context from a stopped clock', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeId = world.users.employee.id;
    const title = `Zeit-Audit ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: `AUF-${world.runId}-P121-AUDIT`,
      title,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });

    await test.step('Start job-linked travel with an explicit route and role', async () => {
      await employeePage.goto('/dashboard');
      const { dialog, confirm } = await openFullActivityDialog(employeePage);
      await activityKindButton(dialog, 'travel').click();
      await chooseActivityJob(employeePage, dialog, title);
      await chooseTravelQualifiers(employeePage, dialog, { route: 'home_to_site', role: 'passenger' });
      await confirm.click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(async () => (await getTimeCaptureState(world.orgId, employeeId)).segments.at(-1)?.kind)
        .toBe('travel');
      expect((await getTimeCaptureState(world.orgId, employeeId)).segments.at(-1)).toMatchObject({
        allocation_kind: 'job',
        travel_route: 'home_to_site',
        travel_role: 'passenger',
      });
    });

    await test.step('Clock out, then start standby with an external context', async () => {
      await clockOut(employeePage);
      const { dialog, confirm } = await openFullActivityDialog(employeePage);
      await activityKindButton(dialog, 'standby').click();
      await chooseStandbyContext(employeePage, dialog, 'remote');
      await confirm.click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(
          async () => (await getTimeCaptureState(world.orgId, employeeId)).segments.at(-1)?.standby_context,
        )
        .toBe('remote');
      await clockOut(employeePage);
    });
  });
});
