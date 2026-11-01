// The real time-tracking settings page and its actions over the in-memory
// database: a field worker who opens it is sent to the profile and changes no
// holiday calendar or closure day; a Büro member reads it with the Büro role
// and sets neither the holiday calendar nor the break rule; an admin of
// another organization neither sees nor removes the organization's closure
// day. The organization's Büro sees that closure day, and its owner sets the
// holiday calendar and the break rule with the same calls, so each refusal
// answers the role or the organization, not a missing row.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, signInAs, tableRows } from './action-boundary-world';
import { field, installPageWorld, refusal, renderTree } from './page-render';
import type { TimeTrackingSettingsValues } from '@/lib/time-tracking/settings';

const otherOwnerId = '6c000000-0000-4000-8000-000000000001';
const closureDayId = '6c000000-0000-4000-8000-000000000002';
const closureDay = { closureDate: '2099-12-24', label: 'Betriebsruhe' };

const world = await installPageWorld({
  organizations: [
    { id: ORGANIZATION_A, admin_id: otherOwnerId },
    { id: ORGANIZATION_B, admin_id: CALLER_ID },
  ],
  organization_settings: [],
  organization_closure_days: [
    {
      id: closureDayId,
      organization_id: ORGANIZATION_A,
      closure_date: closureDay.closureDate,
      label: closureDay.label,
    },
  ],
  organization_members: [],
  time_entries: [],
});
// The page reads the calendar through the cache; the uncached reader it wraps
// answers from the world, and the default break rule stands in for the settings.
const cached = await import('@/lib/data/cached');
const { readOrganizationCalendar } = await import('@/lib/personnel/calendar-reader');
const { getDefaultTimeTrackingSettings } = await import('@/lib/time-tracking/settings');
mock.module('@/lib/data/cached', () => ({
  ...cached,
  getCachedOrganizationCalendar: (organizationId: string) => readOrganizationCalendar(organizationId),
  getCachedOrganizationSettings: async (organizationId: string) =>
    getDefaultTimeTrackingSettings(organizationId),
}));

const { default: TimeTrackingSettingsPage } = await import('@/app/(app)/einstellungen/zeiterfassung/page');
const { TimeTrackingSettingsForm } = await import('@/components/settings/time-tracking-settings-form');
const { HolidayCalendarSettings } = await import('@/components/settings/holiday-calendar-settings');
const { setHolidayRegion, addClosureDay, removeClosureDay } = await import('@/lib/org/calendar-actions');
const { updateTimeTrackingSettings } = await import('@/lib/time-tracking/settings-actions');

const page = () => TimeTrackingSettingsPage();
const notAuthorized = { success: false, error: 'not_authorized' };
const automaticBreak: TimeTrackingSettingsValues = {
  breakMode: 'automatic',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
};
const unchangedRows = (table: string) => JSON.stringify(tableRows(world, table));

/** The props the page passes to the settings components. */
async function renderedSettings(): Promise<{ form: unknown; calendar: unknown }> {
  const elements = await renderTree(page);
  const form = elements.find((element) => element.type === TimeTrackingSettingsForm);
  const calendar = elements.find((element) => element.type === HolidayCalendarSettings);
  assert.ok(form && calendar, 'the page rendered no time-tracking settings');
  return { form: form.props, calendar: calendar.props };
}

const settingsBefore = unchangedRows('organization_settings');
const closureDaysBefore = unchangedRows('organization_closure_days');

// A field worker reaches neither the section nor its writes.
signInAs(world, 'employee');
assert.equal(
  await refusal(page),
  'redirect:/einstellungen/profil',
  'employee on /einstellungen/zeiterfassung',
);
assert.deepEqual(await setHolidayRegion('BY'), notAuthorized);
assert.deepEqual(await addClosureDay({ closureDate: '2099-12-27', label: 'Inventur' }), notAuthorized);
assert.deepEqual(await removeClosureDay(closureDayId), notAuthorized);

// Büro reads the section with its own role and sets neither the holiday
// calendar nor the break rule; it sees the organization's closure day.
signInAs(world, 'buero');
const bueroView = await renderedSettings();
assert.equal(field(bueroView.form, 'role'), 'buero');
assert.equal(field(bueroView.calendar, 'role'), 'buero');
assert.deepEqual(field(bueroView.calendar, 'closureDays'), [{ id: closureDayId, ...closureDay }]);
assert.deepEqual(await setHolidayRegion('BY'), notAuthorized);
assert.deepEqual(await updateTimeTrackingSettings(automaticBreak), notAuthorized);

// The admin of another organization sees none of its closure days and cannot remove one.
signInAs(world, 'admin', ORGANIZATION_B);
assert.deepEqual(field((await renderedSettings()).calendar, 'closureDays'), []);
assert.deepEqual(await removeClosureDay(closureDayId), { success: false, error: 'closure_day_not_found' });

assert.equal(unchangedRows('organization_settings'), settingsBefore, 'a refused call wrote settings');
assert.equal(
  unchangedRows('organization_closure_days'),
  closureDaysBefore,
  'a refused call changed closure days',
);
assert.equal(world.rpcCalls.length, 0, 'a refused call reached the settings write');

// The owner sets both with the same calls, as the session's user in the session's organization.
const organizationA = tableRows(world, 'organizations').find((row) => row.id === ORGANIZATION_A);
assert.ok(organizationA);
organizationA.admin_id = CALLER_ID;
signInAs(world, 'admin');
assert.equal(field((await renderedSettings()).form, 'role'), 'admin');
assert.deepEqual(await setHolidayRegion('BY'), { success: true });
assert.deepEqual(
  tableRows(world, 'organization_settings').map((row) => [row.organization_id, row.holiday_region]),
  [[ORGANIZATION_A, 'BY']],
);
assert.equal((await updateTimeTrackingSettings(automaticBreak)).success, true);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_actor_id, call.args.p_organization_id]),
  [['update_time_tracking_settings', CALLER_ID, ORGANIZATION_A]],
);
