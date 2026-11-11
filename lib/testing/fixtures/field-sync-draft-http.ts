// The actual field sync route handler (POST /api/field-sync/v1/operations)
// with a `work_artifact.draft` operation over the in-memory database. A replay
// is a fresh request: a foreign organization's job id, a job the person is not
// assigned to, a foreign organization in the envelope and a revoked membership
// are refused before the database function; a failed read is a retry; a
// resend of a recorded operation reaches the function even after the
// assignment went, so it can answer `replayed`; the function's refusals keep
// their outcome class; and a bearer token and a cookie reach the same result.
import assert from 'node:assert/strict';
import { z } from '@/lib/zod';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const assignedJobId = '3c000000-0000-4000-8000-000000000020';
const unassignedJobId = '3c000000-0000-4000-8000-000000000021';
const foreignJobId = '3c000000-0000-4000-8000-000000000022';
const missingJobId = '3c000000-0000-4000-8000-000000000023';
const recordedOperationId = '3c000000-0000-4000-8000-000000000050';
const accessToken = 'fixture-access-token';

const world = installActionWorld({
  jobs: [
    { id: assignedJobId, organization_id: ORGANIZATION_A, project_id: null },
    { id: unassignedJobId, organization_id: ORGANIZATION_A, project_id: null },
    { id: foreignJobId, organization_id: ORGANIZATION_B, project_id: null },
  ],
  job_assignments: [
    {
      id: '3c000000-0000-4000-8000-000000000030',
      organization_id: ORGANIZATION_A,
      job_id: assignedJobId,
      user_id: CALLER_ID,
    },
    // The caller's assignment in the other organization never opens its job from this one.
    {
      id: '3c000000-0000-4000-8000-000000000031',
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      user_id: CALLER_ID,
    },
  ],
  // A draft operation the server recorded before the office took its job from the caller.
  work_artifact_draft_operations: [
    { id: recordedOperationId, organization_id: ORGANIZATION_A, actor_id: CALLER_ID },
  ],
});
world.accessTokens = { [accessToken]: CALLER_ID };
const attached = { artifactId: 'unused', revisionId: 'unused', version: 3, replayed: false };
let attachAnswer: { data: unknown; error: { code?: string; message: string } | null } = {
  data: attached,
  error: null,
};
world.rpc = ({ name }) => {
  assert.equal(name, 'attach_work_artifact_draft');
  return attachAnswer;
};

const { POST } = await import('@/app/api/field-sync/v1/operations/route');

const capturedAt = '2026-11-09T07:00:00.000Z';
const sentAt = '2026-11-09T08:00:00.000Z';
let nextId = 0;
function id(): string {
  nextId += 1;
  return `3c000000-0000-4000-8000-00000001${String(nextId).padStart(4, '0')}`;
}

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifactId: id(),
    revisionId: id(),
    jobId: assignedJobId,
    kind: 'work_report',
    visibility: 'internal_only',
    capturedAt,
    title: 'Heizung gewartet',
    content: { performedWork: 'Brenner gereinigt' },
    photos: [
      { linkId: id(), documentId: id() },
      { linkId: id(), documentId: id() },
    ],
    ...overrides,
  };
}

function operation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: id(),
    kind: 'work_artifact.draft',
    capturedAt,
    sentAt,
    organizationId: ORGANIZATION_A,
    payload: draft(),
    ...overrides,
  };
}

function cookieRequest(body: unknown): Request {
  return new Request('http://localhost/api/field-sync/v1/operations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      origin: 'http://localhost',
    },
    body: JSON.stringify(body),
  });
}

function bearerRequest(body: unknown): Request {
  return new Request('http://localhost/api/field-sync/v1/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
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

const forbidden = { outcome: 'rejected', code: 'forbidden' };
const invalid = { outcome: 'rejected', code: 'invalid' };

// An assigned field worker's draft is attached as a draft: the function gets
// the server's organization and user, the device's clocks, both photos and no
// submit; the same content hashes the same whatever the send time.
signInAs(world, 'employee');
const accepted = operation();
assert.deepEqual(await replayBoth(accepted), {
  operationId: accepted.operationId,
  outcome: 'accepted',
  code: 'accepted',
});
const [cookieCall, bearerCall] = world.rpcCalls;
assert.ok(cookieCall && bearerCall);
assert.equal(cookieCall.args.p_organization_id, ORGANIZATION_A);
assert.equal(cookieCall.args.p_actor_id, CALLER_ID);
assert.equal(cookieCall.args.p_operation_id, accepted.operationId);
assert.equal(cookieCall.args.p_captured_at, capturedAt);
assert.equal(cookieCall.args.p_sent_at, sentAt);
assert.equal(cookieCall.args.p_job_id, assignedJobId);
assert.equal(z.array(z.unknown()).parse(cookieCall.args.p_photos).length, 2);
assert.equal('p_submit' in cookieCall.args, false, 'a draft operation carries no submit');
assert.match(z.string().parse(cookieCall.args.p_request_hash), /^[0-9a-f]{64}$/);
world.rpcCalls.length = 0;
await POST(cookieRequest({ operations: [{ ...accepted, sentAt: '2026-11-10T08:00:00.000Z' }] }));
assert.equal(world.rpcCalls[0]?.args.p_request_hash, cookieCall.args.p_request_hash);
await POST(cookieRequest({ operations: [{ ...accepted, capturedAt: '2026-11-09T07:30:00.000Z' }] }));
assert.notEqual(world.rpcCalls[1]?.args.p_request_hash, cookieCall.args.p_request_hash);

// A foreign organization's job id, a job that does not exist and a job the
// person is not assigned to are refused before the database function, as is
// an envelope that names another organization.
world.rpcCalls.length = 0;
for (const jobId of [foreignJobId, missingJobId, unassignedJobId]) {
  const refused = operation({ payload: draft({ jobId }) });
  assert.deepEqual(await replayBoth(refused), { operationId: refused.operationId, ...forbidden });
}
const foreignOrganization = operation({ organizationId: ORGANIZATION_B, payload: draft({ jobId: foreignJobId }) });
assert.deepEqual(await replayBoth(foreignOrganization), {
  operationId: foreignOrganization.operationId,
  outcome: 'rejected',
  code: 'organization_mismatch',
});

// A revoked membership refuses the whole request.
world.memberships = [];
for (const request of [
  cookieRequest({ operations: [operation()] }),
  bearerRequest({ operations: [operation()] }),
]) {
  const revoked = await POST(request);
  assert.equal(revoked.status, 403);
  assert.deepEqual(await revoked.json(), forbidden);
}
signInAs(world, 'employee');

// A draft that breaks the draft rules, asks for more than a draft, names a
// photo twice or names a project is refused as invalid.
for (const payload of [
  draft({ title: '' }),
  draft({ submit: true, submitActionId: id() }),
  draft({ correctsRevisionId: id(), correctionReason: 'Nachtrag' }),
  draft({ expectedVersion: 4 }),
  draft({ targetType: 'project', targetId: id() }),
  draft({ photos: [{ linkId: id(), documentId: assignedJobId }, { linkId: id(), documentId: assignedJobId }] }),
  draft({ photos: [{ linkId: id(), documentId: id(), storagePath: `${ORGANIZATION_B}/x.jpg` }] }),
  draft({ photos: Array.from({ length: 21 }, () => ({ linkId: id(), documentId: id() })) }),
]) {
  const refused = operation({ payload });
  assert.deepEqual(await replayBoth(refused), { operationId: refused.operationId, ...invalid });
}
assert.equal(world.rpcCalls.length, 0, 'a refused draft reached the database function');

// An office role needs no assignment, but the job must be the organization's.
signInAs(world, 'buero');
const office = operation({ payload: draft({ jobId: unassignedJobId }) });
assert.deepEqual(await replayBoth(office), { operationId: office.operationId, outcome: 'accepted', code: 'accepted' });
const officeForeign = operation({ payload: draft({ jobId: foreignJobId }) });
assert.deepEqual(await replayBoth(officeForeign), { operationId: officeForeign.operationId, ...forbidden });
signInAs(world, 'employee');

// A read that cannot complete is a retry, never a refusal, and the rest of the batch waits.
world.rpcCalls.length = 0;
for (const table of ['work_artifact_draft_operations', 'jobs', 'job_assignments']) {
  world.failingTables.add(table);
  const unread = operation();
  const waiting = operation();
  const readFailure = await POST(cookieRequest({ operations: [unread, waiting] }));
  assert.deepEqual(await readFailure.json(), {
    results: [
      { operationId: unread.operationId, outcome: 'retry', code: 'unavailable' },
      { operationId: waiting.operationId, outcome: 'retry', code: 'unavailable' },
    ],
  });
  world.failingTables.delete(table);
}
assert.equal(world.rpcCalls.length, 0);

// A resend of a recorded operation reaches the function without the job
// check, so the person learns the draft arrived after the office took the job.
attachAnswer = { data: { ...attached, replayed: true }, error: null };
const resent = operation({ operationId: recordedOperationId, payload: draft({ jobId: unassignedJobId }) });
assert.deepEqual(await replayBoth(resent), {
  operationId: recordedOperationId,
  outcome: 'replayed',
  code: 'replayed',
});
assert.equal(world.rpcCalls.length, 2);

// The database function's refusals keep their outcome class.
for (const [message, expected] of [
  ['work_artifact_not_authorized', forbidden],
  ['work_artifact_draft_photo_invalid', invalid],
  ['work_artifact_draft_idempotency_conflict', { outcome: 'rejected', code: 'idempotency_conflict' }],
  ['work_artifact_revision_idempotency_conflict', { outcome: 'rejected', code: 'idempotency_conflict' }],
  ['work_artifact_stale_version', { outcome: 'conflict', code: 'version_conflict' }],
  ['work_artifact_is_voided', { outcome: 'conflict', code: 'office_changed' }],
  ['connection reset', { outcome: 'retry', code: 'unavailable' }],
] as const) {
  attachAnswer = { data: null, error: { message } };
  const refused = operation();
  assert.deepEqual(await replayBoth(refused), { operationId: refused.operationId, ...expected });
}
