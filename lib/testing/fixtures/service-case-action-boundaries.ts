// Actual service-case actions over the in-memory database: a field worker is
// refused the case register before any database access and reads a job's
// service context only on an own assigned job; a customer, case number, case,
// request or job of another organization is unreachable.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const foreignClientId = '85000000-0000-4000-8000-000000000001';
const foreignCaseId = '85000000-0000-4000-8000-000000000002';
const foreignRequestId = '85000000-0000-4000-8000-000000000003';
const foreignJobId = '85000000-0000-4000-8000-000000000004';
const ownCaseId = '85000000-0000-4000-8000-000000000005';
const revisionId = '85000000-0000-4000-8000-000000000006';
const idempotencyKey = '85000000-0000-4000-8000-000000000007';

const world = installActionWorld({
  clients: [{ id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremder Kunde' }],
  service_cases: [
    {
      id: foreignCaseId,
      organization_id: ORGANIZATION_B,
      case_number: 'SF-0001',
      job_id: foreignJobId,
      status: 'new',
    },
  ],
  job_assignments: [],
});
const {
  getServiceClientOption,
  getServiceCaseDetailByNumber,
  createServiceCase,
  updateServiceCase,
  linkServiceCaseRelation,
  linkServiceCaseEvidence,
  getAssignedServiceContextForJob,
} = await import('@/lib/service-cases/actions');

const change = { expectedVersion: 1, idempotencyKey };
const officeCalls = [
  ['getServiceClientOption', () => getServiceClientOption(foreignClientId)],
  ['getServiceCaseDetailByNumber', () => getServiceCaseDetailByNumber('SF-0001')],
  [
    'createServiceCase',
    () =>
      createServiceCase({
        serviceCaseId: ownCaseId,
        idempotencyKey,
        sourceRequestId: foreignRequestId,
        chargeContext: 'unknown',
        equipmentIds: [],
      }),
  ],
  [
    'updateServiceCase',
    () =>
      updateServiceCase({
        ...change,
        serviceCaseId: foreignCaseId,
        summary: 'Heizung fällt aus',
        urgency: 'normal',
        status: 'new',
        chargeContext: 'unknown',
        equipmentIds: [],
        reason: 'Angaben ergänzt',
      }),
  ],
  [
    'linkServiceCaseRelation',
    () =>
      linkServiceCaseRelation({
        ...change,
        serviceCaseId: ownCaseId,
        relatedServiceCaseId: foreignCaseId,
        relationType: 'related',
        reason: 'Gleiche Anlage',
      }),
  ],
  [
    'linkServiceCaseEvidence',
    () =>
      linkServiceCaseEvidence({
        ...change,
        serviceCaseId: foreignCaseId,
        workArtifactRevisionId: revisionId,
      }),
  ],
] as const;
const fieldContext = [
  'getAssignedServiceContextForJob',
  () => getAssignedServiceContextForJob(foreignJobId),
] as const;

// Field workers are refused the case register before the service-role client exists,
// and a job they are not assigned to (here: another organization's) before any case read.
signInAs(world, 'employee');
await assertRefused(world, officeCalls, { success: false, error: 'not_authorized' }, 'none');
await assertRefused(world, [fieldContext], { success: false, error: 'not_authorized' }, 'reads');

// Büro finds no case number or customer of another organization, and another
// organization's job shows none of its cases.
signInAs(world, 'buero');
await assertRefused(world, [officeCalls[1]], { success: false, error: 'service_case_not_found' }, 'reads');
assert.deepEqual(await getServiceClientOption(foreignClientId), { success: true, client: null });
assert.deepEqual(await getAssignedServiceContextForJob(foreignJobId), { success: true, contexts: [] });

// The write functions refuse a foreign case or request under their lock
// because the action passes the caller's organization; one call each.
refuseForeignIds(
  world,
  new Map([
    [foreignCaseId, 'service_case_not_found'],
    [foreignRequestId, 'service_case_request_not_found'],
  ]),
);
const refusals = [
  [officeCalls[2], 'service_case_request_not_found'],
  [officeCalls[3], 'service_case_not_found'],
  [officeCalls[4], 'service_case_not_found'],
  [officeCalls[5], 'service_case_not_found'],
] as const;
for (const [call, error] of refusals) {
  await assertRefused(world, [call], { success: false, error }, 'one-call');
  assert.equal(
    world.rpcCalls[0]?.args.p_organization_id,
    ORGANIZATION_A,
    `${call[0]}: not the caller's organization`,
  );
}
