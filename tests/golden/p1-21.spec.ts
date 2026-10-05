import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { expect, test } from './support/fixtures';
import { getTimeCaptureState, seedLegacyOpenTimeEntry } from './support/db/time-tracking';
import { clockInOnJob, clockOut, switchClockActivity } from './support/steps/time-tracking';
import { createJob } from './support/steps/work';

// The browser walks the clock as a user does. Version, operation and event
// arithmetic, replay, recovery, job execution start and tenant isolation are
// proven in supabase/tests/p1_21_time_segments.sql.

test.describe('P1-21 explicit time activities @P1-21', () => {
  test('starts on a job, switches every activity in the sheet and clocks out @P1-21-stage-start @P1-21-stage-switch @P1-21-stage-end', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeId = world.users.employee.id;
    const sessionId = await test.step('Start job-linked work', async () => {
      const title = `Zeitsegmente ${world.runId}`;
      await createJob(adminPage, {
        jobNumber: `AUF-${world.runId}-P121`,
        title,
        assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      });
      await clockInOnJob(employeePage, title);
      await expect
        .poll(async () => (await getTimeCaptureState(world.orgId, employeeId)).segments.at(-1)?.kind)
        .toBe('work');
      const state = await getTimeCaptureState(world.orgId, employeeId);
      const session = expectDefined(state.sessions.at(-1), 'the started session');
      expect(session.status).toBe('open');
      expect(state.segments.filter((segment) => segment.session_id === session.id)).toMatchObject([
        { kind: 'work', allocation_kind: 'job', ended_at: null },
      ]);
      return session.id;
    });

    await test.step('Switch through travel, break, standby, call-out and internal work', async () => {
      await employeePage.goto('/dashboard');
      for (const kind of ['travel', 'break', 'standby', 'callout', 'internal_activity'] as const) {
        await switchClockActivity(employeePage, kind);
        await expect
          .poll(
            async () =>
              (await getTimeCaptureState(world.orgId, employeeId)).segments
                .filter((segment) => segment.session_id === sessionId)
                .at(-1)?.kind,
          )
          .toBe(kind);
      }
    });

    await test.step('Clock out', async () => {
      await clockOut(employeePage);
      await expect
        .poll(
          async () =>
            (await getTimeCaptureState(world.orgId, employeeId)).sessions.find(
              (session) => session.id === sessionId,
            )?.status,
        )
        .toBe('closed');
    });
  });

  test('continues an open legacy clock into the canonical model @P1-21-stage-legacy', async ({
    bueroPage,
    world,
  }) => {
    const bueroId = world.users.buero.id;
    await seedLegacyOpenTimeEntry(world.orgId, bueroId);
    await bueroPage.goto('/dashboard');
    await switchClockActivity(bueroPage, 'standby');

    await expect
      .poll(async () => (await getTimeCaptureState(world.orgId, bueroId)).segments.at(-1)?.kind)
      .toBe('standby');
    const state = await getTimeCaptureState(world.orgId, bueroId);
    expect(state.legacyEntries.at(-1)).toMatchObject({
      entry_type: 'clock_out',
      capture_source: 'legacy_compatibility',
    });
    await clockOut(bueroPage);
  });
});
