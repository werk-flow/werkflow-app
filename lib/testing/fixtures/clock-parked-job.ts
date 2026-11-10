// The actual clock transition over the in-memory database: when the database
// refuses a parked job (`time_transition_job_unavailable`, proven in
// supabase/tests/p1_21_time_segments.sql), the action answers with that code
// for a clock-in, a switch and a resume, and the clock shows its sentence.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const parkedJobId = '8d000000-0000-4000-8000-000000000001';
const sessionId = '8d000000-0000-4000-8000-000000000002';

const world = installActionWorld({
  employee_records: [
    { id: '8d000000-0000-4000-8000-000000000003', organization_id: ORGANIZATION_A, user_id: CALLER_ID },
  ],
});
// The database function raises the refusal as PL/pgSQL does.
world.rpc = () => ({ data: null, error: { code: 'P0001', message: 'time_transition_job_unavailable' } });

const { transitionTimeActivity } = await import('@/lib/time-tracking/segment-actions');
const { getTransitionErrorMessage } = await import('@/lib/time-tracking/clock-actions');
const { createActivitySelection } = await import('@/lib/time-tracking/segments');

signInAs(world, 'employee');
const work = createActivitySelection('work', parkedJobId);
for (const [action, expectedSessionId, expectedVersion] of [
  ['start', null, null],
  ['switch', sessionId, 2],
  ['recover_continue', sessionId, 3],
] as const) {
  const result = await transitionTimeActivity({
    organizationId: ORGANIZATION_A,
    operationId: crypto.randomUUID(),
    action,
    expectedSessionId,
    expectedVersion,
    selection: work,
    acknowledgeLong: false,
  });
  assert.deepEqual(result, { success: false, error: 'time_transition_job_unavailable' }, action);
}
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_action, call.args.p_job_id]),
  [
    ['transition_time_activity', 'start', parkedJobId],
    ['transition_time_activity', 'switch', parkedJobId],
    ['transition_time_activity', 'recover_continue', parkedJobId],
  ],
);
assert.equal(
  getTransitionErrorMessage('time_transition_job_unavailable', 'Fallback'),
  'Dieser Auftrag ist geparkt oder abgeschlossen. Wähle einen anderen Auftrag.',
);
