// Actual work-artifact and instruction-evidence writes over the in-memory
// database: an artifact is saved only on a job of the caller's organization
// that a manager runs or the employee is assigned to, an approval names a
// revision of the caller's organization, and every other write names the
// caller's organization and the caller, so the function's org-scoped lookup
// refuses an artifact, requirement or fulfillment of organization B with one
// call. A refused call writes nothing.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import {
  assertCallerScopedCalls,
  databaseSnapshot,
  installScopedFunctions,
} from './workforce-boundary-support';

const ownJobId = '8b000000-0000-4000-8000-000000000001';
const foreignJobId = '8b000000-0000-4000-8000-000000000002';
const foreignArtifactId = '8b000000-0000-4000-8000-000000000003';
const foreignRevisionId = '8b000000-0000-4000-8000-000000000004';
const foreignRequirementId = '8b000000-0000-4000-8000-000000000005';
const foreignFulfillmentId = '8b000000-0000-4000-8000-000000000006';
const newId = '8b000000-0000-4000-8000-000000000007';
const documentId = '8b000000-0000-4000-8000-000000000008';
const timeEntryId = '8b000000-0000-4000-8000-000000000009';

const world = installActionWorld({
  jobs: [
    { id: ownJobId, organization_id: ORGANIZATION_A },
    { id: foreignJobId, organization_id: ORGANIZATION_B },
  ],
  work_artifacts: [{ id: foreignArtifactId, organization_id: ORGANIZATION_B, job_id: foreignJobId }],
  work_artifact_revisions: [
    {
      id: foreignRevisionId,
      organization_id: ORGANIZATION_B,
      artifact_id: foreignArtifactId,
      created_by: CALLER_ID,
    },
  ],
  job_instruction_item_evidence_requirements: [{ id: foreignRequirementId, organization_id: ORGANIZATION_B }],
  job_instruction_item_evidence_fulfillments: [{ id: foreignFulfillmentId, organization_id: ORGANIZATION_B }],
});
// The artifact functions load their target inside the organization they are
// given (supabase/tests/p1_15_*.sql); here only that lookup and its code.
const artifact = { table: 'work_artifacts', idArgument: 'p_artifact_id', refusal: 'work_artifact_not_found' };
installScopedFunctions(world, {
  record_work_artifact_action: artifact,
  void_work_artifact: artifact,
  link_work_artifact_document: artifact,
  link_work_artifact_source: artifact,
  fulfill_instruction_evidence: {
    table: 'job_instruction_item_evidence_requirements',
    idArgument: 'p_evidence_requirement_id',
    refusal: 'instruction_evidence_requirement_not_found',
  },
  remove_instruction_evidence_fulfillment: {
    table: 'job_instruction_item_evidence_fulfillments',
    idArgument: 'p_fulfillment_id',
    refusal: 'instruction_evidence_fulfillment_not_found',
  },
});
const {
  fulfillInstructionEvidence,
  linkWorkArtifactDocument,
  linkWorkArtifactSource,
  recordWorkArtifactAction,
  removeInstructionEvidenceFulfillment,
  saveWorkArtifact,
  voidWorkArtifact,
} = await import('@/lib/work-artifacts/actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const save = (targetId: string) =>
  saveWorkArtifact({
    artifactId: newId,
    revisionId: newId,
    expectedVersion: null,
    targetType: 'job',
    targetId,
    kind: 'work_report',
    visibility: 'internal_only',
    capturedAt: '2026-10-20T10:00:00+02:00',
    title: 'Arbeitsbericht',
    content: { performedWork: 'Heizung gewartet' },
    submit: false,
  });
const action = (actionType: 'internal_approved' | 'review_requested') =>
  recordWorkArtifactAction({
    artifactId: foreignArtifactId,
    revisionId: foreignRevisionId,
    actionId: newId,
    expectedVersion: 1,
    actionType,
  });

// An employee saves no artifact on a job they are not assigned to.
signInAs(world, 'employee');
assert.deepEqual(await save(ownJobId), notAuthorized);
assert.equal(world.rpcCalls.length, 0);

// An Admin of organization A saves nothing on a job of organization B and approves no foreign revision.
signInAs(world, 'admin');
assert.deepEqual(await save(foreignJobId), notAuthorized);
assert.deepEqual(await action('internal_approved'), { success: false, error: 'work_artifact_not_found' });
assert.equal(world.rpcCalls.length, 0);

// Every other write names the caller's organization and is refused by its one call.
const writes = [
  () => action('review_requested'),
  () =>
    voidWorkArtifact({
      artifactId: foreignArtifactId,
      actionId: newId,
      expectedVersion: 1,
      reason: 'Falsch',
    }),
  () =>
    linkWorkArtifactDocument({
      artifactId: foreignArtifactId,
      revisionId: foreignRevisionId,
      linkId: newId,
      expectedVersion: 1,
      documentId,
      relation: 'supporting_evidence',
    }),
  () =>
    linkWorkArtifactSource({
      artifactId: foreignArtifactId,
      revisionId: foreignRevisionId,
      linkId: newId,
      expectedVersion: 1,
      timeEntryId,
    }),
  () =>
    fulfillInstructionEvidence({
      fulfillmentId: newId,
      evidenceRequirementId: foreignRequirementId,
      documentId,
    }),
  () =>
    removeInstructionEvidenceFulfillment({
      fulfillmentId: foreignFulfillmentId,
      expectedVersion: 1,
      reason: 'Falsch',
    }),
];
for (const [index, write] of writes.entries()) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await write(), { success: false, error: 'work_artifact_action_failed' }, `write ${index}`);
  assert.equal(world.rpcCalls.length, 1, `write ${index}: a refused write made a second call`);
  assertCallerScopedCalls(world);
}
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
