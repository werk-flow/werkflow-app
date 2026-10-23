// Actual organization settings, calendar, deletion and switch actions over
// the in-memory database: only the owner renames, deletes or sets the
// holiday region of the organization, a field worker changes no closure day,
// a closure day of another organization is not found, and nobody switches
// into an organization they are not a member of.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const otherOwnerId = '88000000-0000-4000-8000-000000000001';
const foreignClosureDayId = '88000000-0000-4000-8000-000000000002';

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, name: 'Musterbetrieb', unique_code: 'ABCDEF', admin_id: otherOwnerId },
    { id: ORGANIZATION_B, name: 'Fremdbetrieb', unique_code: 'GHIJKL', admin_id: CALLER_ID },
  ],
  organization_settings: [],
  organization_closure_days: [
    { id: foreignClosureDayId, organization_id: ORGANIZATION_B, closure_date: '2099-12-24' },
  ],
});
const { updateOrganizationSettings } = await import('@/lib/org/settings-actions');
const { setHolidayRegion, addClosureDay, removeClosureDay } = await import('@/lib/org/calendar-actions');
const { deleteOrganization } = await import('@/lib/org/delete-action');
const { setActiveOrgCookie } = await import('@/lib/org/actions');

const ownerOnly = [
  [
    'updateOrganizationSettings',
    () => updateOrganizationSettings({ name: 'Neuer Name', uniqueCode: 'MNPQRS' }),
  ],
  ['deleteOrganization', () => deleteOrganization('Musterbetrieb')],
  ['setHolidayRegion', () => setHolidayRegion(null)],
] as const;
const closureDays = [
  ['addClosureDay', () => addClosureDay({ closureDate: '2099-12-27', label: 'Betriebsruhe' })],
  ['removeClosureDay', () => removeClosureDay(foreignClosureDayId)],
] as const;

// An admin who is not the owner is refused after the owner read, before any
// write; the caller owns organization B, which these actions never reach
// while A is active.
signInAs(world, 'admin');
await assertRefused(world, ownerOnly, { success: false, error: 'not_authorized' }, 'reads');

// Field workers change no closure day and reach no database.
signInAs(world, 'employee');
await assertRefused(world, closureDays, { success: false, error: 'not_authorized' }, 'none');

// Büro does not find another organization's closure day; the row stays.
signInAs(world, 'buero');
await assertRefused(world, [closureDays[1]], { success: false, error: 'closure_day_not_found' }, 'reads');
assert.equal(world.tables.organization_closure_days?.length, 1);

// Nobody switches into an organization without a current membership there.
await assertRefused(
  world,
  [['setActiveOrgCookie', () => setActiveOrgCookie(ORGANIZATION_B)]],
  { success: false, error: 'not_a_member' },
  'none',
);
assert.equal(world.activeOrganizationCookie, ORGANIZATION_A);
