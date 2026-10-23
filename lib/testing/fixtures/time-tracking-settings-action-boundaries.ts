// The actual break-policy settings action over the in-memory database: only
// the organization's owner changes it, so an admin, Büro member or field
// worker who is not the owner is refused after the owner read and writes nothing.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownerId = '8c000000-0000-4000-8000-000000000001';

const world = installActionWorld({
  organizations: [{ id: ORGANIZATION_A, admin_id: ownerId }],
  organization_settings: [],
});
const { updateTimeTrackingSettings } = await import('@/lib/time-tracking/settings-actions');

for (const role of ['admin', 'buero', 'employee'] as const) {
  signInAs(world, role);
  await assertRefused(
    world,
    [
      [
        'updateTimeTrackingSettings',
        () =>
          updateTimeTrackingSettings({
            breakMode: 'automatic',
            autoBreakThresholdMinutes: 360,
            autoBreakDurationMinutes: 30,
          }),
      ],
    ],
    { success: false, error: 'not_authorized' },
    'reads',
  );
}
assert.deepEqual(world.tables.organization_settings, []);
