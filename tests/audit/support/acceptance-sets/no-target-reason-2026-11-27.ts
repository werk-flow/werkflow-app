import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { seedWorkSchedule } from '../../../golden/support/db/personnel';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

type Role = 'admin' | 'buero' | 'employee';

/** The role's own Zeiterfassung under a Wochenplan without working days, from a month back. */
function ownFreeDay(role: Role) {
  return async (world: TestWorld): Promise<SurfaceDestination> => {
    await surfaceFixture(world, `acceptance.no-target-reason-${role}`, async () => {
      const { data: record } = await createAdminClient()
        .from('employee_records')
        .select('id')
        .eq('organization_id', world.orgId)
        .eq('user_id', world.users[role].id)
        .single()
        .throwOnError();
      await seedWorkSchedule({
        organizationId: world.orgId,
        employeeRecordId: record.id,
        actorUserId: world.users.admin.id,
        validFrom: berlinDateAtOffset(-30),
        weekdayMinutes: 0,
        note: `Ohne Arbeitstage ${world.runId}`,
      });
      return record.id;
    });
    return { route: '/zeiterfassung', heading: 'Zeiterfassung' };
  };
}

/**
 * werk-flow/werkflow-planning#201 of 2026-11-27: the Zeiterfassung names why
 * today has no target with the member list's reason, here a day the person's
 * Wochenplan leaves free.
 */
function noTargetReasonCaptures(): OpenSet {
  const both = { widths: [375, 1280], schemes: ['light', 'dark'] } as const;
  const roles: readonly Role[] = ['employee', 'buero', 'admin'];
  return {
    id: 'no-target-reason-2026-11-27',
    captures: roles.map((role) => ({
      id: `${role}-zeiterfassung`,
      role,
      route: '/zeiterfassung',
      view: { kind: 'page' },
      destination: ownFreeDay(role),
      ...both,
    })),
    standalone: [],
  };
}

acceptanceSet(noTargetReasonCaptures());
