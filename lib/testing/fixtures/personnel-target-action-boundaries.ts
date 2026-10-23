// Actual daily-target reads over the in-memory database: a field worker reads
// only the own weekly targets and never the team's targets of today; both
// refusals come before any database access.
import { installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const colleagueUserId = '89000000-0000-4000-8000-000000000001';

const world = installActionWorld({});
const { getWeeklyTargets, getTodayTargetsForMembers } = await import('@/lib/personnel/target-actions');

signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['getWeeklyTargets', () => getWeeklyTargets({ userId: colleagueUserId })],
    ['getTodayTargetsForMembers', () => getTodayTargetsForMembers()],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);
