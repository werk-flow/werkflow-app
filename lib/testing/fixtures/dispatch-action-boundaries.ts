// Actual dispatch actions over the in-memory database: a field worker can
// only answer a dispatch, never issue, cancel, resolve or reschedule one; a
// visit, job, dispatch or challenge of another organization is unreachable;
// and each refused write leaves no row behind.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const foreignOccurrenceId = '82000000-0000-4000-8000-000000000001';
const foreignJobId = '82000000-0000-4000-8000-000000000002';
const foreignDispatchId = '82000000-0000-4000-8000-000000000003';
const foreignAcknowledgementId = '82000000-0000-4000-8000-000000000004';
const ownEmployeeRecordId = '82000000-0000-4000-8000-000000000005';
const requestId = '82000000-0000-4000-8000-000000000006';

const world = installActionWorld({
  employee_records: [{ id: ownEmployeeRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID }],
  jobs: [{ id: foreignJobId, organization_id: ORGANIZATION_B, status: 'open' }],
  planning_occurrences: [
    {
      id: foreignOccurrenceId,
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      status: 'scheduled',
      start_at: '2027-01-04T08:00:00.000Z',
    },
  ],
  planning_dispatches: [
    {
      id: foreignDispatchId,
      organization_id: ORGANIZATION_B,
      occurrence_id: null,
      job_id: foreignJobId,
      status: 'active',
      current_revision_id: null,
    },
  ],
});
const {
  getDispatchOverview,
  getJobDispatchCards,
  previewDispatchReadiness,
  issueDispatch,
  acknowledgeDispatch,
  challengeDispatch,
  resolveDispatchChallenge,
  cancelDispatch,
  previewBatchReschedule,
  batchReschedule,
} = await import('@/lib/dispatch/actions');

const notAuthorized = { success: false, error: 'not_authorized' };
const selection = { occurrenceIds: [foreignOccurrenceId], dayShift: 1, newTime: null };
const issueInput = {
  occurrenceId: null,
  jobId: foreignJobId,
  recipientEmployeeRecordIds: null,
  note: null,
  requestId,
};
const batchInput = {
  ...selection,
  reason: 'Kunde hat verschoben',
  requestId,
  overrideReason: null,
  assessmentFingerprint: null,
};
const managerCalls = [
  ['getDispatchOverview', () => getDispatchOverview('2026-11-01', '2026-11-30')],
  ['previewDispatchReadiness', () => previewDispatchReadiness({ occurrenceId: foreignOccurrenceId })],
  ['issueDispatch', () => issueDispatch(issueInput)],
  [
    'resolveDispatchChallenge',
    () => resolveDispatchChallenge(foreignAcknowledgementId, 'Geklärt mit dem Kunden'),
  ],
  ['cancelDispatch', () => cancelDispatch(foreignDispatchId, 'Termin entfällt')],
  ['previewBatchReschedule', () => previewBatchReschedule(selection)],
  ['batchReschedule', () => batchReschedule(batchInput)],
] as const;

// A field worker is refused every planning write and the office reads
// before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(world, managerCalls, notAuthorized, 'none');

// A field worker answers only dispatches of the own organization: the answer
// is one call naming the caller's organization, which refuses a foreign dispatch.
refuseForeignIds(world, new Map([[foreignDispatchId, 'dispatch_not_found']]));
await assertRefused(
  world,
  [
    ['acknowledgeDispatch', () => acknowledgeDispatch(foreignDispatchId, 1)],
    ['challengeDispatch', () => challengeDispatch(foreignDispatchId, 1, 'Termin passt nicht')],
  ],
  { success: false, error: 'dispatch_not_found' },
  'one-call',
);
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);

// Another organization's active dispatch of that job never reaches the card list.
assert.deepEqual(await getJobDispatchCards(foreignJobId), { success: true, cards: [] });

// Büro reaches only the own organization's visits, jobs, dispatches and challenges.
signInAs(world, 'buero');
await assertRefused(
  world,
  [managerCalls[1]],
  { success: false, error: 'dispatch_occurrence_not_found' },
  'reads',
);
await assertRefused(world, [managerCalls[2]], { success: false, error: 'dispatch_job_not_found' }, 'reads');
await assertRefused(
  world,
  [managerCalls[5], managerCalls[6]],
  { success: false, error: 'batch_item_not_found' },
  'reads',
);
refuseForeignIds(
  world,
  new Map([
    [foreignDispatchId, 'dispatch_not_found'],
    [foreignAcknowledgementId, 'challenge_not_found'],
  ]),
);
await assertRefused(world, [managerCalls[4]], { success: false, error: 'dispatch_not_found' }, 'one-call');
await assertRefused(world, [managerCalls[3]], { success: false, error: 'challenge_not_found' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
