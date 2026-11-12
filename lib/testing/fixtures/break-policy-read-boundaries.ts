// The actual break-rule reader over the in-memory database: every member of
// the organization reads its rule with the versions, and a caller who names
// another organization is refused before any settings read.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';

const versions = [
  {
    breakMode: 'automatic',
    autoBreakThresholdMinutes: 360,
    autoBreakDurationMinutes: 30,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  },
];
const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, admin_id: '8c000000-0000-4000-8000-000000000001' },
    { id: ORGANIZATION_B, admin_id: '8c000000-0000-4000-8000-000000000002' },
  ],
});
// The cached settings reader has its own tests; the stand-in returns the
// organization's stored rule and records each read, so a refusal proves it
// came before any settings read.
const settingsReads: string[] = [];
mock.module('@/lib/time-tracking/organization-settings-read', () => ({
  readOrganizationSettings: async (organizationId: string) => {
    settingsReads.push(organizationId);
    return {
      organizationId,
      breakMode: 'automatic',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      breakPolicyHistory: versions,
    };
  },
}));
const { getBreakPolicy } = await import('@/lib/time-tracking/break-policy-read');

for (const role of ['admin', 'buero', 'employee'] as const) {
  signInAs(world, role);
  const own = await getBreakPolicy(ORGANIZATION_A);
  assert.equal(own.success, true, `${role} reads the own organization's rule`);
  if (own.success) assert.deepEqual(own.breakPolicy.breakPolicyHistory, versions, role);

  settingsReads.length = 0;
  const foreign = await getBreakPolicy(ORGANIZATION_B);
  assert.equal(foreign.success, false, `${role} is refused another organization's rule`);
  assert.deepEqual(settingsReads, [], `${role}'s refused read reads no settings`);
}

signInAs(world, null);
settingsReads.length = 0;
assert.equal((await getBreakPolicy(ORGANIZATION_A)).success, false, 'a caller without a session is refused');
assert.deepEqual(settingsReads, [], 'a caller without a session reads no settings');
