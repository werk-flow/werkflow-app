import { resolveBerlinWallTime } from '../../../lib/planning/date-time';
import { createAdminClient } from './db/shared';
import { getEmployeeRecordStateByUser } from './db/personnel';
import type { TestWorld } from './world';

/** Own the starting state; no personnel or schedule UI test has to run first. */
export async function prepareScheduleScenario(
  world: TestWorld,
  input: {
    today: string;
    previousMonday: string;
    employeeSchedule?: boolean;
    holidayRegion?: 'BY' | null;
  },
): Promise<void> {
  const midnight = resolveBerlinWallTime(`${input.today}T00:00`);
  if (!midnight) throw new Error('Invalid schedule fixture date.');
  const admin = createAdminClient();
  const employee = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
  const buero = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);
  for (const table of ['work_schedules', 'employment_conditions', 'organization_closure_days'] as const) {
    const { error } = await admin.from(table).delete().eq('organization_id', world.orgId);
    if (error) throw new Error(`Schedule fixture reset ${table}: ${error.message}`);
  }
  const { error: conditionError } = await admin.from('employment_conditions').insert({
    organization_id: world.orgId,
    employee_record_id: employee.id,
    employment_type: 'teilzeit',
    weekly_hours: 25,
    valid_from: input.previousMonday,
    created_by: world.users.admin.id,
  });
  if (conditionError) throw new Error(`Schedule fixture condition: ${conditionError.message}`);
  const region = input.holidayRegion === undefined ? 'BY' : input.holidayRegion;
  const { error: settingsError } = await admin.from('organization_settings').upsert(
    {
      organization_id: world.orgId,
      holiday_region: region,
      holiday_region_history: region ? [{ region, effectiveFrom: midnight.instant.toISOString() }] : [],
    },
    { onConflict: 'organization_id' },
  );
  if (settingsError) throw new Error(`Schedule fixture calendar: ${settingsError.message}`);
  const scheduleRecords = input.employeeSchedule !== false ? [employee.id] : [];
  for (const recordId of scheduleRecords) {
    const { error } = await admin.from('work_schedules').insert({
      organization_id: world.orgId,
      employee_record_id: recordId,
      valid_from: input.previousMonday,
      monday_minutes: 480,
      tuesday_minutes: 480,
      wednesday_minutes: 480,
      thursday_minutes: 480,
      friday_minutes: 480,
      saturday_minutes: 0,
      sunday_minutes: 0,
      created_by: world.users.admin.id,
    });
    if (error) throw new Error(`Schedule fixture plan: ${error.message}`);
  }
  // Match employment dates to the scenario; no historical UI run supplies them.
  const { error: recordError } = await admin
    .from('employee_records')
    .update({ entry_date: input.previousMonday })
    .eq('organization_id', world.orgId)
    .in('id', [employee.id, buero.id]);
  if (recordError) throw new Error(`Schedule fixture entry date: ${recordError.message}`);
}
