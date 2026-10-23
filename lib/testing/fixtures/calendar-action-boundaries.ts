// Actual calendar window, board and preference actions over the in-memory
// database: each takes an organization id from the client, and an id other
// than the caller's active organization is refused before any database
// access; a caller without an active organization is refused the same way.
import { ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const world = installActionWorld({});
const { getCalendarWindow } = await import('@/lib/calendar/actions');
const { getCalendarBoardContext } = await import('@/lib/calendar/board-actions');
const { saveCalendarPreferences } = await import('@/lib/calendar/preferences-actions');

const window = { fromDate: '2026-11-02', toDate: '2026-11-08' };
const callsFor = (organizationId: string) =>
  [
    [
      'getCalendarWindow',
      () =>
        getCalendarWindow({
          ...window,
          organizationId,
          from: '2026-11-01T23:00:00.000Z',
          to: '2026-11-08T22:59:59.999Z',
        }),
    ],
    ['getCalendarBoardContext', () => getCalendarBoardContext({ ...window, organizationId })],
    [
      'saveCalendarPreferences',
      () => saveCalendarPreferences(organizationId, { view: 'week', horizonWeeks: 1 }),
    ],
  ] as const;

// Every role is refused another organization's calendar before any read or write.
for (const role of ['admin', 'buero', 'employee'] as const) {
  signInAs(world, role);
  await assertRefused(
    world,
    callsFor(ORGANIZATION_B),
    { success: false, error: 'organization_changed' },
    'none',
  );
}

// A caller without an active organization reads and stores nothing.
signInAs(world, null);
await assertRefused(world, callsFor(ORGANIZATION_B), { success: false, error: 'no_active_org' }, 'none');
