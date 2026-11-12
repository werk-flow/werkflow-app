// The online clock call and the field sync route handler (POST
// /api/field-sync/v1/operations) over an in-memory operation ledger that
// behaves as transition_time_activity does: an operation id is recorded once,
// and a second request under it replays the first result only with the same
// organization, employee and request hash. A phone whose page closed before the
// online call's answer sends the same action captured; the transition core then
// asks once more as the online call asked (lib/time-tracking/transition-core.ts).
import assert from 'node:assert/strict';
import { z } from '@/lib/zod';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const employeeA = '8e000000-0000-4000-8000-000000000001';
const otherUserId = '8e000000-0000-4000-8000-000000000002';
const employeeB = '8e000000-0000-4000-8000-000000000003';
const sessionId = '8e000000-0000-4000-8000-000000000010';
/** The database's own clock for an online call, which omits a captured time. */
const SERVER_TIME = '2026-11-09T07:00:05.000Z';
const capturedAt = '2026-11-09T07:00:00.000Z';
const sentAt = '2026-11-09T07:10:00.000Z';

const world = installActionWorld({
  employee_records: [
    { id: employeeA, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: employeeB, organization_id: ORGANIZATION_B, user_id: otherUserId },
  ],
  time_operations: [],
});

type LedgerRow = {
  id: string;
  organization_id: string;
  employee_record_id: string;
  request_hash: string;
  recorded_at: string;
  result_payload: Record<string, unknown>;
};
const ledger: LedgerRow[] = [];

world.rpc = ({ name, args }) => {
  assert.equal(name, 'transition_time_activity');
  const employee = (world.tables.employee_records ?? []).find(
    (row) => row.organization_id === args.p_organization_id && row.user_id === args.p_actor_id,
  );
  const existing = ledger.find((row) => row.id === args.p_operation_id);
  if (existing) {
    if (
      existing.organization_id !== args.p_organization_id ||
      existing.employee_record_id !== employee?.id ||
      existing.request_hash !== args.p_request_hash
    )
      return { data: null, error: { message: 'time_transition_idempotency_conflict' } };
    return { data: { ...existing.result_payload, replayed: true }, error: null };
  }
  const payload = { outcome: 'active', sessionId, segmentId: null, version: 1, replayed: false };
  const row = {
    id: String(args.p_operation_id),
    organization_id: String(args.p_organization_id),
    employee_record_id: String(employee?.id),
    request_hash: String(args.p_request_hash),
    recorded_at: typeof args.p_captured_at === 'string' ? args.p_captured_at : SERVER_TIME,
    result_payload: payload,
  };
  ledger.push(row);
  (world.tables.time_operations ??= []).push({ id: row.id, organization_id: row.organization_id });
  return { data: payload, error: null };
};

const { POST } = await import('@/app/api/field-sync/v1/operations/route');
const { transitionTimeActivity } = await import('@/lib/time-tracking/segment-actions');

const selection = { kind: 'work' as const, allocationKind: 'unallocated' as const, jobId: null };

function captured(operationId: string, organizationId: string, payload: Record<string, unknown> = {}) {
  return {
    operationId,
    kind: 'time.transition',
    capturedAt,
    sentAt,
    organizationId,
    payload: {
      action: 'start',
      expectedSessionId: null,
      expectedVersion: null,
      selection,
      acknowledgeLong: false,
      ...payload,
    },
  };
}

async function send(operation: Record<string, unknown>): Promise<unknown> {
  const response = await POST(
    new Request('http://localhost/api/field-sync/v1/operations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ operations: [operation] }),
    }),
  );
  assert.equal(response.status, 200);
  return z.object({ results: z.array(z.unknown()).length(1) }).parse(await response.json()).results[0];
}

// (i) The online call records the start; its page closes before the answer. The phone sends the
// same action captured under the same operation id: the server replays the first result, and the
// recorded time stays the online call's server time, not the captured one.
signInAs(world, 'employee');
const onlineId = '8e000000-0000-4000-8000-000000000101';
const online = await transitionTimeActivity({
  organizationId: ORGANIZATION_A,
  operationId: onlineId,
  action: 'start',
  expectedSessionId: null,
  expectedVersion: null,
  selection,
  acknowledgeLong: false,
});
assert.equal(online.success, true);
assert.deepEqual(await send(captured(onlineId, ORGANIZATION_A)), {
  operationId: onlineId,
  outcome: 'replayed',
  code: 'replayed',
  state: { sessionId, segmentId: null, version: 1 },
});
assert.equal(ledger.length, 1, 'the captured send recorded the action a second time');
assert.equal(ledger[0]?.recorded_at, SERVER_TIME, 'the captured send moved the recorded time');

// (ii) The same id with another command is a different action: it stays the idempotency conflict.
assert.deepEqual(await send(captured(onlineId, ORGANIZATION_A, { acknowledgeLong: true })), {
  operationId: onlineId,
  outcome: 'rejected',
  code: 'idempotency_conflict',
});
assert.equal(ledger.length, 1);

// (iii) Another organization's caller sending that id gets nothing of the first result.
world.callerId = otherUserId;
world.memberships = [{ orgId: ORGANIZATION_B, role: 'employee' }];
world.activeOrganizationCookie = ORGANIZATION_B;
const foreign = await send(captured(onlineId, ORGANIZATION_B));
assert.deepEqual(foreign, { operationId: onlineId, outcome: 'rejected', code: 'idempotency_conflict' });
assert.ok(!JSON.stringify(foreign).includes(sessionId), 'the foreign caller saw the first result');
assert.equal(ledger.length, 1);
