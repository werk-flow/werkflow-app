// Which Arbeitsnachweis steps, of every kind, count as usage statistics, over the in-memory database
// (werk-flow/werkflow-planning#280): a first save starts the report, a submit or a
// review request completes it, a void abandons it, and a replay the database
// answers with `duplicate: true` counts nothing.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const jobId = '8c000000-0000-4000-8000-000000000001';
const artifactId = '8c000000-0000-4000-8000-000000000002';
const revisionId = '8c000000-0000-4000-8000-000000000003';
const actionId = '8c000000-0000-4000-8000-000000000004';

const world = installActionWorld({
  jobs: [{ id: jobId, organization_id: ORGANIZATION_A }],
  work_artifacts: [],
  work_artifact_revisions: [],
});
const captured: string[] = [];
mock.module('@/lib/usage-statistics/capture', () => ({
  captureUsage: (organizationId: string, workflow: string, step: string) => {
    assert.equal(organizationId, ORGANIZATION_A);
    captured.push(`${workflow}_${step}`);
  },
}));
const { recordWorkArtifactAction, saveWorkArtifact, voidWorkArtifact } = await import(
  '@/lib/work-artifacts/actions'
);

function answer(duplicate: boolean): void {
  world.rpc = () => ({ data: { version: 2, status: 'submitted', duplicate }, error: null });
}
async function countedBy(duplicate: boolean, step: () => Promise<{ success: boolean }>): Promise<string[]> {
  answer(duplicate);
  captured.length = 0;
  const result = await step();
  assert.equal(result.success, true, JSON.stringify(result));
  return [...captured];
}

const save = (submit: boolean, expectedVersion: number | null) => () =>
  saveWorkArtifact({
    artifactId,
    revisionId,
    expectedVersion,
    targetType: 'job',
    targetId: jobId,
    kind: 'work_report',
    visibility: 'internal_only',
    capturedAt: '2026-10-20T10:00:00+02:00',
    title: 'Arbeitsbericht',
    content: {
      performedWork: 'Heizung gewartet',
      visitStartedAt: '2026-10-20T08:00:00+02:00',
      visitEndedAt: '2026-10-20T10:00:00+02:00',
    },
    submit,
    ...(submit ? { submitActionId: actionId } : {}),
  });
const requestReview = () =>
  recordWorkArtifactAction({
    artifactId,
    revisionId,
    actionId,
    expectedVersion: 1,
    actionType: 'review_requested',
  });
const voidReport = () =>
  voidWorkArtifact({ artifactId, actionId, expectedVersion: 1, reason: 'Doppelt erfasst' });

signInAs(world, 'admin');
assert.deepEqual(await countedBy(false, save(false, null)), ['work_evidence_started']);
assert.deepEqual(await countedBy(false, save(true, null)), [
  'work_evidence_started',
  'work_evidence_completed',
]);
assert.deepEqual(await countedBy(false, save(false, 1)), [], 'a later draft save starts nothing');
assert.deepEqual(await countedBy(false, save(true, 1)), ['work_evidence_completed']);
assert.deepEqual(
  await countedBy(false, requestReview),
  ['work_evidence_completed'],
  'a review request completes',
);
assert.deepEqual(await countedBy(false, voidReport), ['work_evidence_abandoned']);

for (const replay of [save(true, null), requestReview, voidReport]) {
  assert.deepEqual(await countedBy(true, replay), [], 'a replay counts nothing');
}
