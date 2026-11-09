// The actual field sync route handler (POST /api/field-sync/v1/operations)
// and the online clock action over the in-memory database. A replay is a
// fresh request: a foreign or inactive organization's id, another person's
// session and a revoked membership are refused before the database function,
// a failed read is a retry that halts the batch, and the database function
// refuses a closed period and the offline window; a bearer token and a cookie
// session reach the same result; and the online action sends exactly the
// arguments and hash it sent before offline capture existed.
import assert from 'node:assert/strict';
import { z } from '@/lib/zod';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const ownSessionId = '8d000000-0000-4000-8000-000000000010';
const otherSessionId = '8d000000-0000-4000-8000-000000000011';
const otherUserId = '8d000000-0000-4000-8000-000000000012';
const foreignSessionId = '8d000000-0000-4000-8000-000000000013';
const missingSessionId = '8d000000-0000-4000-8000-000000000014';
const jobId = '8d000000-0000-4000-8000-000000000020';
const accessToken = 'fixture-access-token';

const world = installActionWorld({
  employee_records: [
    { id: '8d000000-0000-4000-8000-000000000001', organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: '8d000000-0000-4000-8000-000000000002', organization_id: ORGANIZATION_A, user_id: otherUserId },
  ],
  time_sessions: [
    { id: ownSessionId, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: otherSessionId, organization_id: ORGANIZATION_A, user_id: otherUserId },
    { id: foreignSessionId, organization_id: ORGANIZATION_B, user_id: CALLER_ID },
  ],
  // The office approved a full-day vacation on the captured day after an offline start was recorded.
  vacation_requests: [
    {
      id: '8d000000-0000-4000-8000-000000000040',
      organization_id: ORGANIZATION_A,
      employee_record_id: '8d000000-0000-4000-8000-000000000001',
      status: 'approved',
      day_portion: 'full',
      start_date: '2026-11-09',
      end_date: '2026-11-09',
    },
  ],
  time_operations: [{ id: '8d000000-0000-4000-8000-000000000041', organization_id: ORGANIZATION_A }],
});
world.accessTokens = { [accessToken]: CALLER_ID };
const ended = { outcome: 'ended', sessionId: ownSessionId, segmentId: null, version: 3, replayed: false };
let transitionAnswer: { data: unknown; error: { code?: string; message: string } | null } = {
  data: ended,
  error: null,
};
world.rpc = ({ name }) => {
  assert.equal(name, 'transition_time_activity');
  return transitionAnswer;
};

const { POST } = await import('@/app/api/field-sync/v1/operations/route');
const { transitionTimeActivity } = await import('@/lib/time-tracking/segment-actions');
const { hashTimeTransitionRequest } = await import('@/lib/time-tracking/transition-hash');

// Fixed instants: the database function, mocked here, owns every rule about the clock.
const capturedAt = '2026-11-09T07:00:00.000Z';
const sentAt = '2026-11-09T08:00:00.000Z';
let nextOperation = 0;

function operation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nextOperation += 1;
  return {
    operationId: `8d000000-0000-4000-8000-0000000001${String(nextOperation).padStart(2, '0')}`,
    kind: 'time.transition',
    capturedAt,
    sentAt,
    organizationId: ORGANIZATION_A,
    payload: {
      action: 'end',
      expectedSessionId: ownSessionId,
      expectedVersion: 2,
      selection: null,
      acknowledgeLong: false,
    },
    ...overrides,
  };
}

function cookieRequest(body: unknown, site = 'same-origin'): Request {
  return new Request('http://localhost/api/field-sync/v1/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': site, origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

function bearerRequest(body: unknown, token = accessToken): Request {
  return new Request('http://localhost/api/field-sync/v1/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** The one operation result of a single-operation batch, through both authentications; they must agree. */
async function replayBoth(op: Record<string, unknown>): Promise<unknown> {
  const viaCookie = await POST(cookieRequest({ operations: [op] }));
  assert.equal(viaCookie.status, 200);
  const cookieBody: unknown = await viaCookie.json();
  // The bearer request carries no session: a signed-out cookie must not matter.
  const signedInAs = world.callerId;
  world.callerId = null;
  const viaBearer = await POST(bearerRequest({ operations: [op] }));
  world.callerId = signedInAs;
  assert.equal(viaBearer.status, 200);
  assert.deepEqual(await viaBearer.json(), cookieBody, 'bearer and cookie reach different results');
  return z.object({ results: z.array(z.unknown()).length(1) }).parse(cookieBody).results[0];
}

// An accepted offline transition is recorded at its captured time, through
// the same database function and hash rule as an online call.
signInAs(world, 'employee');
const accepted = operation();
assert.deepEqual(await replayBoth(accepted), {
  operationId: accepted.operationId,
  outcome: 'accepted',
  code: 'accepted',
  state: { sessionId: ownSessionId, segmentId: null, version: 3 },
});
const [offlineCall] = world.rpcCalls;
assert.ok(offlineCall);
assert.equal(offlineCall.args.p_actor_id, CALLER_ID);
assert.equal(offlineCall.args.p_organization_id, ORGANIZATION_A);
assert.equal(offlineCall.args.p_captured_at, capturedAt);
assert.equal(offlineCall.args.p_sent_at, sentAt);
assert.equal(
  offlineCall.args.p_request_hash,
  hashTimeTransitionRequest({
    organizationId: ORGANIZATION_A,
    action: 'end',
    expectedSessionId: ownSessionId,
    expectedVersion: 2,
    selection: null,
    acknowledgeLong: false,
    capturedAt,
  }),
);

// A replay with a foreign organization's id, also one the caller belongs to
// but is not active in, another person's session (an employee cannot act for
// anyone else) or after the membership was revoked is refused before the
// database function. The envelope's organization is a hint, never a switch.
world.rpcCalls.length = 0;
const mismatch = { outcome: 'rejected', code: 'organization_mismatch' };
const foreign = operation({ organizationId: ORGANIZATION_B });
assert.deepEqual(await replayBoth(foreign), { operationId: foreign.operationId, ...mismatch });
world.memberships = [
  { orgId: ORGANIZATION_A, role: 'employee' },
  { orgId: ORGANIZATION_B, role: 'employee' },
];
const inactive = operation({ organizationId: ORGANIZATION_B });
assert.deepEqual(await replayBoth(inactive), { operationId: inactive.operationId, ...mismatch });
signInAs(world, 'employee');
const othersSession = operation({
  payload: {
    action: 'end',
    expectedSessionId: otherSessionId,
    expectedVersion: 1,
    selection: null,
    acknowledgeLong: false,
  },
});
assert.deepEqual(await replayBoth(othersSession), {
  operationId: othersSession.operationId,
  outcome: 'rejected',
  code: 'forbidden',
});
// A session the caller holds in another organization, or one that does not
// exist, is refused the same way: the database function must never see it.
for (const expectedSessionId of [foreignSessionId, missingSessionId]) {
  const unknownSession = operation({
    payload: {
      action: 'end',
      expectedSessionId,
      expectedVersion: 1,
      selection: null,
      acknowledgeLong: false,
    },
  });
  assert.deepEqual(await replayBoth(unknownSession), {
    operationId: unknownSession.operationId,
    outcome: 'rejected',
    code: 'forbidden',
  });
}
world.memberships = [];
for (const request of [
  cookieRequest({ operations: [operation()] }),
  bearerRequest({ operations: [operation()] }),
]) {
  const revoked = await POST(request);
  assert.equal(revoked.status, 403);
  assert.deepEqual(await revoked.json(), { outcome: 'rejected', code: 'forbidden' });
}
assert.equal(world.rpcCalls.length, 0, 'a refused replay reached the database function');
signInAs(world, 'employee');

// A read that cannot complete is a retry, never a refusal, and the rest of
// the batch waits for it.
world.failingTables.add('employee_records');
const unread = operation();
const waiting = operation();
const readFailure = await POST(cookieRequest({ operations: [unread, waiting] }));
assert.deepEqual(await readFailure.json(), {
  results: [
    { operationId: unread.operationId, outcome: 'retry', code: 'unavailable' },
    { operationId: waiting.operationId, outcome: 'retry', code: 'unavailable' },
  ],
});
assert.equal(world.rpcCalls.length, 0);
world.failingTables.delete('employee_records');

// The database function's refusals keep their outcome class: a closed
// period, the offline window, a reused operation id and a moved clock.
for (const [error, expected] of [
  [
    { code: 'WFP01', message: 'period_closed' },
    { outcome: 'rejected', code: 'closed_period' },
  ],
  [{ message: 'time_transition_correction_required' }, { outcome: 'conflict', code: 'correction_required' }],
  [
    { message: 'time_transition_outside_recording_window' },
    { outcome: 'rejected', code: 'outside_recording_window' },
  ],
  [{ message: 'time_transition_captured_in_future' }, { outcome: 'rejected', code: 'invalid' }],
  [
    { message: 'time_transition_idempotency_conflict' },
    { outcome: 'rejected', code: 'idempotency_conflict' },
  ],
  [{ message: 'time_transition_captured_out_of_order' }, { outcome: 'conflict', code: 'version_conflict' }],
  [{ message: 'time_transition_job_terminal' }, { outcome: 'conflict', code: 'office_changed' }],
] as const) {
  transitionAnswer = { data: null, error };
  const refused = operation();
  assert.deepEqual(await replayBoth(refused), { operationId: refused.operationId, ...expected });
}

// A start or switch onto a job the office blocked while the phone was offline is a
// conflict the office resolves, never a retry: the rest of the batch still runs.
world.rpcCalls.length = 0;
const answers = [
  { data: null, error: { message: 'work_transition_start_blocked' } },
  { data: ended, error: null },
];
world.rpc = ({ name }) => {
  assert.equal(name, 'transition_time_activity');
  const answer = answers.shift();
  assert.ok(answer, 'the batch called the database function more often than it holds operations');
  return answer;
};
// A switch, because the fixture's vacation would refuse a start before the database function.
const blockedSwitch = operation({
  payload: {
    action: 'switch',
    expectedSessionId: ownSessionId,
    expectedVersion: 2,
    selection: { kind: 'work', allocationKind: 'job', jobId },
    acknowledgeLong: false,
  },
});
const afterBlocked = operation();
const blockedBatch = await POST(cookieRequest({ operations: [blockedSwitch, afterBlocked] }));
assert.deepEqual(await blockedBatch.json(), {
  results: [
    { operationId: blockedSwitch.operationId, outcome: 'conflict', code: 'office_changed' },
    {
      operationId: afterBlocked.operationId,
      outcome: 'accepted',
      code: 'accepted',
      state: { sessionId: ownSessionId, segmentId: null, version: 3 },
    },
  ],
});
assert.equal(world.rpcCalls.length, 2, 'a blocked job halted the batch');
world.rpc = ({ name }) => {
  assert.equal(name, 'transition_time_activity');
  return transitionAnswer;
};

// A resend answers `replayed`; a stored recovery answer stays a conflict.
transitionAnswer = { data: { ...ended, replayed: true }, error: null };
const resent = operation();
assert.deepEqual(await replayBoth(resent), {
  operationId: resent.operationId,
  outcome: 'replayed',
  code: 'replayed',
  state: { sessionId: ownSessionId, segmentId: null, version: 3 },
});
transitionAnswer = {
  data: {
    outcome: 'recovery_required',
    sessionId: ownSessionId,
    segmentId: null,
    version: 4,
    replayed: true,
  },
  error: null,
};
const recovering = operation();
assert.deepEqual(await replayBoth(recovering), {
  operationId: recovering.operationId,
  outcome: 'conflict',
  code: 'recovery_required',
  state: { sessionId: ownSessionId, segmentId: null, version: 4 },
});

// An approved vacation refuses a new offline start on its day, but a resend
// of a start recorded before the approval still answers its first result.
world.rpcCalls.length = 0;
const startPayload = {
  action: 'start',
  expectedSessionId: null,
  expectedVersion: null,
  selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
  acknowledgeLong: false,
};
const onVacation = operation({ payload: startPayload });
assert.deepEqual(await replayBoth(onVacation), {
  operationId: onVacation.operationId,
  outcome: 'conflict',
  code: 'office_changed',
});
assert.equal(world.rpcCalls.length, 0);
transitionAnswer = { data: { ...ended, outcome: 'active', replayed: true }, error: null };
const recordedStart = operation({
  operationId: '8d000000-0000-4000-8000-000000000041',
  payload: startPayload,
});
assert.deepEqual(await replayBoth(recordedStart), {
  operationId: recordedStart.operationId,
  outcome: 'replayed',
  code: 'replayed',
  state: { sessionId: ownSessionId, segmentId: null, version: 3 },
});
transitionAnswer = { data: ended, error: null };

// After a transient failure the rest of the batch waits: a later transition
// of the same clock depends on the earlier one.
world.rpcCalls.length = 0;
transitionAnswer = { data: null, error: { message: 'connection reset' } };
const first = operation();
const second = operation();
const halted = await POST(cookieRequest({ operations: [first, second] }));
assert.deepEqual(await halted.json(), {
  results: [
    { operationId: first.operationId, outcome: 'retry', code: 'unavailable' },
    { operationId: second.operationId, outcome: 'retry', code: 'unavailable' },
  ],
});
assert.equal(world.rpcCalls.length, 1);
transitionAnswer = { data: ended, error: null };

// An envelope the server cannot read is refused per operation; an unknown kind is never guessed.
const unknownKind = operation({ kind: 'material.use' });
const undatable = operation({ capturedAt: 'gestern' });
const invalid = await POST(cookieRequest({ operations: [unknownKind, undatable, { kind: 'x' }] }));
assert.deepEqual(await invalid.json(), {
  results: [
    { operationId: unknownKind.operationId, outcome: 'rejected', code: 'invalid' },
    { operationId: undatable.operationId, outcome: 'rejected', code: 'invalid' },
    { operationId: null, outcome: 'rejected', code: 'invalid' },
  ],
});

// A request without a verified identity, from another site, or without a batch is refused whole.
world.rpcCalls.length = 0;
const unauthenticated = { outcome: 'retry', code: 'unauthenticated' };
const badToken = await POST(bearerRequest({ operations: [operation()] }, 'expired-token'));
assert.equal(badToken.status, 401);
assert.deepEqual(await badToken.json(), unauthenticated);
const malformed = await POST(
  new Request('http://localhost/api/field-sync/v1/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic abc' },
    body: JSON.stringify({ operations: [operation()] }),
  }),
);
assert.equal(malformed.status, 401);
world.callerId = null;
const signedOut = await POST(cookieRequest({ operations: [operation()] }));
assert.equal(signedOut.status, 401);
assert.deepEqual(await signedOut.json(), unauthenticated);
signInAs(world, 'employee');
const crossSite = await POST(cookieRequest({ operations: [operation()] }, 'cross-site'));
assert.equal(crossSite.status, 403);
assert.deepEqual(await crossSite.json(), { outcome: 'rejected', code: 'forbidden' });
for (const body of [{ operations: [] }, { operations: 'all' }, null]) {
  const response = await POST(cookieRequest(body));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { outcome: 'rejected', code: 'invalid' });
}
assert.equal(world.rpcCalls.length, 0, 'a refused request reached the database function');

// The online action is unchanged: the same arguments, no captured time, and
// the hash it always produced (computed with the hash rule before offline capture).
world.rpcCalls.length = 0;
transitionAnswer = { data: { ...ended, outcome: 'active' }, error: null };
const online = await transitionTimeActivity({
  organizationId: ORGANIZATION_A,
  operationId: '8d000000-0000-4000-8000-000000000030',
  action: 'switch',
  expectedSessionId: ownSessionId,
  expectedVersion: 3,
  selection: { kind: 'work', allocationKind: 'job', jobId },
  acknowledgeLong: false,
});
assert.equal(online.success, true);
const [onlineCall] = world.rpcCalls;
assert.ok(onlineCall);
assert.deepEqual(Object.keys(onlineCall.args).sort(), [
  'p_acknowledge_long',
  'p_action',
  'p_actor_id',
  'p_allocation_kind',
  'p_expected_session_id',
  'p_expected_version',
  'p_internal_type',
  'p_job_id',
  'p_operation_id',
  'p_organization_id',
  'p_request_hash',
  'p_segment_kind',
  'p_standby_context',
  'p_travel_role',
  'p_travel_route',
]);
assert.equal(
  onlineCall.args.p_request_hash,
  'a4517c54c26d53287737dc18019b88871cb21fd9b4b22ce83d44a7ba03575fe4',
);
// The online action's answer to a blocked job is unchanged too.
transitionAnswer = { data: null, error: { message: 'work_transition_start_blocked' } };
assert.deepEqual(
  await transitionTimeActivity({
    organizationId: ORGANIZATION_A,
    operationId: '8d000000-0000-4000-8000-000000000031',
    action: 'switch',
    expectedSessionId: ownSessionId,
    expectedVersion: 3,
    selection: { kind: 'work', allocationKind: 'job', jobId },
    acknowledgeLong: false,
  }),
  { success: false, error: 'time_transition_failed' },
);
