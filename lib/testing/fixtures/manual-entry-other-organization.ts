// The actual manual-entry action over the in-memory database: a person still
// clocked in at another organization keeps a new open entry out, and the
// refusal names that organization only to a caller who is a member there.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { getLocalDayStart } from '@/lib/date-time/berlin';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const employeeId = '8d000000-0000-4000-8000-000000000001';
const otherOrganizationName = 'Andere Haustechnik GmbH';
// Hours into yesterday's local day, so every entry lies on one past day at any time of day.
const yesterdayStart = getLocalDayStart(new Date(Date.now() - 24 * 60 * 60 * 1000));
const yesterdayAt = (hour: number): string =>
  new Date(yesterdayStart.getTime() + hour * 60 * 60 * 1000).toISOString();
// The employee clocked in at organization B yesterday and never clocked out.
const openSessionStart = yesterdayAt(8);

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, name: 'Eigene Haustechnik GmbH' },
    { id: ORGANIZATION_B, name: otherOrganizationName },
  ],
  organization_members: [
    { user_id: employeeId, organization_id: ORGANIZATION_A, role: 'employee' },
    { user_id: employeeId, organization_id: ORGANIZATION_B, role: 'employee' },
  ],
  time_entries: [
    {
      id: '8d000000-0000-4000-8000-000000000002',
      organization_id: ORGANIZATION_B,
      user_id: employeeId,
      entry_type: 'clock_in',
      timestamp: openSessionStart,
      is_manual: false,
      job_id: null,
      status: 'approved',
      reviewed_by: null,
      reviewed_at: null,
      created_at: openSessionStart,
      updated_at: openSessionStart,
    },
  ],
  time_periods: [],
});
// The organization's break settings have their own tests; manual breaks stand in.
mock.module('@/lib/time-tracking/organization-settings-read', () => ({
  readOrganizationSettings: async () => ({
    breakMode: 'manual',
    autoBreakThresholdMinutes: 360,
    autoBreakDurationMinutes: 30,
  }),
}));
const { addManualEntry } = await import('@/lib/time-tracking/entry-write-actions');

// An open clock-in for the employee an hour later, in the named organization.
const openEntryIn = (organizationId: string) =>
  addManualEntry({
    organizationId,
    targetUserId: employeeId,
    entries: [{ entryType: 'clock_in', timestamp: yesterdayAt(9) }],
  });
const initialDatabase = databaseSnapshot(world);

// A Büro member of organization A only learns that the employee is clocked in
// elsewhere, never which organization: neither its id nor its name.
signInAs(world, 'buero', ORGANIZATION_A);
const refusedForNonmember = await openEntryIn(ORGANIZATION_A);
assert.deepEqual(refusedForNonmember, { success: false, error: 'working_in_other_org' });
const refusalText = JSON.stringify(refusedForNonmember);
assert.ok(!refusalText.includes(ORGANIZATION_B), 'the refusal names the other organization id');
assert.ok(!refusalText.includes(otherOrganizationName), 'the refusal names the other organization');

// A caller who belongs to both organizations still reads where the employee is clocked in.
world.memberships = [
  { orgId: ORGANIZATION_A, role: 'buero' },
  { orgId: ORGANIZATION_B, role: 'employee' },
];
assert.deepEqual(await openEntryIn(ORGANIZATION_A), {
  success: false,
  error: 'working_in_other_org',
  otherOrgName: otherOrganizationName,
});

// Organization B's id as the target is refused before anything is read about it.
signInAs(world, 'buero', ORGANIZATION_A);
assert.deepEqual(await openEntryIn(ORGANIZATION_B), { success: false, error: 'not_a_member' });

assert.equal(databaseSnapshot(world), initialDatabase, 'no refused entry may be written');
