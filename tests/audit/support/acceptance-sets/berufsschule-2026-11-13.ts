import { worldName } from '../../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { seedEmploymentCondition, seedNoLoginPersonnelRecord } from '../../../golden/support/db/personnel';
import { seedSchoolDay } from '../../../golden/support/db/school-days';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** An apprentice without a login, with a weekly school day and a Blockunterricht, on the office's detail page. */
async function apprenticeRecord(world: TestWorld): Promise<SurfaceDestination> {
  const lastName = worldName('Azubi', world.runId);
  const recordId = await surfaceFixture(world, 'acceptance.berufsschule-apprentice-record', async () => {
    const id = await seedNoLoginPersonnelRecord({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      firstName: 'Mia',
      lastName,
      entryDate: berlinDateAtOffset(-60),
    });
    await seedEmploymentCondition({
      organizationId: world.orgId,
      employeeRecordId: id,
      actorUserId: world.users.admin.id,
      validFrom: berlinDateAtOffset(-60),
      employmentType: 'ausbildung',
      weeklyHours: 40,
      vacationDaysPerYear: 30,
      note: `Ausbildung ${world.runId}`,
    });
    await seedSchoolDay({
      organizationId: world.orgId,
      employeeRecordId: id,
      actorUserId: world.users.admin.id,
      rule: { kind: 'weekday', weekday: 0, startDate: berlinDateAtOffset(1) },
    });
    await seedSchoolDay({
      organizationId: world.orgId,
      employeeRecordId: id,
      actorUserId: world.users.admin.id,
      rule: { kind: 'block', startDate: berlinDateAtOffset(30), endDate: berlinDateAtOffset(41) },
    });
    return id;
  });
  return { route: `/mitarbeiter/${recordId}`, heading: `Mia ${lastName}` };
}

/** The world's employee as an apprentice with a Blockunterricht this week and next, today included. */
async function seedOwnSchoolWeek(world: TestWorld): Promise<void> {
  await surfaceFixture(world, 'acceptance.berufsschule-own-week', async () => {
    const { data: record } = await createAdminClient()
      .from('employee_records')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('user_id', world.users.employee.id)
      .single()
      .throwOnError();
    return seedSchoolDay({
      organizationId: world.orgId,
      employeeRecordId: record.id,
      actorUserId: world.users.admin.id,
      rule: { kind: 'block', startDate: berlinDateAtOffset(0), endDate: berlinDateAtOffset(13) },
    });
  });
}

async function ownTimeTracking(world: TestWorld): Promise<SurfaceDestination> {
  await seedOwnSchoolWeek(world);
  return { route: '/zeiterfassung', heading: 'Zeiterfassung' };
}

async function ownCalendar(world: TestWorld): Promise<SurfaceDestination> {
  await seedOwnSchoolWeek(world);
  return { route: '/kalender', heading: 'Kalender' };
}

/**
 * werk-flow/werkflow-planning#165 of 2026-11-13: Büro records an apprentice's
 * Berufsschule days in the personnel record; the apprentice sees a school day
 * in Zeiterfassung, where the day's target counts as met, and in the calendar.
 */
function berufsschuleCaptures(): OpenSet {
  const both = { widths: [375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'berufsschule-2026-11-13',
    captures: [
      {
        id: 'buero-mitarbeiter-userId',
        role: 'buero',
        route: '/mitarbeiter/[userId]',
        view: { kind: 'page' },
        destination: apprenticeRecord,
        reveal: 'Berufsschule erfassen',
        ...both,
      },
      {
        id: 'admin-mitarbeiter-userId-dialog-school-day-add',
        role: 'admin',
        route: '/mitarbeiter/[userId]',
        view: { kind: 'dialog', opener: 'people.school-day-add' },
        ...both,
      },
      {
        id: 'employee-zeiterfassung',
        role: 'employee',
        route: '/zeiterfassung',
        view: { kind: 'page' },
        destination: ownTimeTracking,
        ...both,
      },
      {
        id: 'employee-zeiterfassung-week',
        role: 'employee',
        route: '/zeiterfassung',
        view: { kind: 'page' },
        destination: ownTimeTracking,
        reveal: 'Überstunden',
        ...both,
      },
      {
        id: 'employee-kalender',
        role: 'employee',
        route: '/kalender',
        view: { kind: 'page' },
        destination: ownCalendar,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(berufsschuleCaptures());
