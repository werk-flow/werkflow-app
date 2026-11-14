// The Bereitschaft actions over the in-memory database
// (werk-flow/werkflow-planning#469). A signed-out caller, an employee, a
// suspended or ended manager and a manager who names another organization are
// refused before any database call. Admin and Büro write only through the one
// database function of each action, which carries the organization and actor
// the server resolved, never the client's; a shift or person of another
// organization is refused by that function and nothing is written.
// supabase/tests/on_call_shifts.sql proves the function's own refusals.
import assert from 'node:assert/strict';

import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const shiftA = '46900000-0000-4000-8000-0000000000a1';
const nextShift = '46900000-0000-4000-8000-0000000000a2';
const personA = '46900000-0000-4000-8000-0000000000a3';
const foreignShift = '46900000-0000-4000-8000-0000000000b1';
const foreignPerson = '46900000-0000-4000-8000-0000000000b3';

const world = installActionWorld({ on_call_shifts: [], on_call_shift_members: [], on_call_shift_events: [] });
const actions = await import('@/lib/on-call/actions');

const startsAt = '2026-11-20T15:00:00.000Z';
const endsAt = '2026-11-23T06:00:00.000Z';
const state = (organizationId: string, shiftId: string, memberId: string) => ({
  organizationId,
  shiftId,
  startsAt,
  endsAt,
  label: 'Heizung',
  handoverNote: 'Schlüssel liegt im Fahrzeug',
  memberIds: [memberId],
  confirmOverlap: false,
});
const everyAction = (organizationId: string, shiftId: string, memberId: string) =>
  [
    ['planOnCallShift', () => actions.planOnCallShift(state(organizationId, shiftId, memberId))],
    [
      'changeOnCallShift',
      () => actions.changeOnCallShift({ ...state(organizationId, shiftId, memberId), expectedVersion: 1 }),
    ],
    ['endOnCallShift', () => actions.endOnCallShift({ organizationId, shiftId, expectedVersion: 1 })],
    [
      'handOverOnCallShift',
      () =>
        actions.handOverOnCallShift({
          organizationId,
          shiftId,
          expectedVersion: 1,
          nextShiftId: nextShift,
          nextEndsAt: endsAt,
          nextLabel: 'Heizung',
          handoverNote: 'Therme Lindenstraße 4 beobachten',
          memberIds: [memberId],
          confirmOverlap: false,
        }),
    ],
  ] as const;

world.callerId = null;
await assertRefused(
  world,
  everyAction(ORGANIZATION_A, shiftA, personA),
  { success: false, error: 'not_authenticated' },
  'none',
);

// A field worker reads who is on call and plans nothing.
signInAs(world, 'employee');
await assertRefused(
  world,
  everyAction(ORGANIZATION_A, shiftA, personA),
  { success: false, error: 'not_authorized' },
  'none',
);

for (const role of ['admin', 'buero'] as const) {
  // A manager of A who names B is no member there, whatever the cookie says.
  signInAs(world, role);
  world.activeOrganizationCookie = ORGANIZATION_B;
  await assertRefused(
    world,
    everyAction(ORGANIZATION_B, foreignShift, foreignPerson),
    { success: false, error: 'not_a_member' },
    'none',
  );
  // A suspended or ended manager is no current member.
  for (const accessState of ['suspended', 'ended'] as const) {
    signInAs(world, role);
    world.memberships = [{ orgId: ORGANIZATION_A, role, accessState }];
    await assertRefused(
      world,
      everyAction(ORGANIZATION_A, shiftA, personA),
      { success: false, error: 'not_a_member' },
      'none',
    );
  }

  // A shift or a person of B named in A reaches only the one function, which refuses it.
  signInAs(world, role);
  refuseForeignIds(
    world,
    new Map([
      [foreignShift, 'on_call_shift_not_found'],
      [foreignPerson, 'on_call_member_invalid'],
    ]),
  );
  for (const [name, call] of everyAction(ORGANIZATION_A, foreignShift, personA)) {
    if (name === 'planOnCallShift') continue;
    await assertRefused(world, [[name, call]], { success: false, error: 'on_call_shift_not_found' }, 'one-call');
  }
  await assertRefused(
    world,
    everyAction(ORGANIZATION_A, shiftA, foreignPerson).filter(([name]) => name !== 'endOnCallShift'),
    { success: false, error: 'on_call_member_invalid' },
    'one-call',
  );

  // Admin and Büro write their own organization's shift as themselves.
  world.rpc = ({ args }) => ({
    data: { shiftId: args.p_next_shift_id ?? args.p_shift_id, version: 1 },
    error: null,
  });
  for (const [name, call] of everyAction(ORGANIZATION_A, shiftA, personA)) {
    world.rpcCalls.length = 0;
    assert.equal((await call()).success, true, `${name} as ${role}`);
    assert.equal(world.rpcCalls.length, 1, `${name} made one call`);
    assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A, `${name}: organization`);
    assert.equal(world.rpcCalls[0]?.args.p_actor_id, CALLER_ID, `${name}: actor`);
  }
}

// A malformed id never reaches the database.
signInAs(world, 'admin');
await assertRefused(
  world,
  [['endOnCallShift', () => actions.endOnCallShift({ organizationId: ORGANIZATION_A, shiftId: 'x', expectedVersion: 1 })]],
  { success: false, error: 'invalid_input' },
  'none',
);
