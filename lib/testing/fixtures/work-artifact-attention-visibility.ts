// The real work-artifact attention derivation over the in-memory database: a
// field worker's list of due defects leaves out a coworker's internal draft,
// as the Arbeitsnachweis detail readers do, and keeps the caller's own draft
// and a coworker's customer-facing one. A manager sees every due defect of the
// own organization, and another organization's defect reaches nobody.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { ActionContext } from '@/lib/org/action-context';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, installActionWorld } from './action-boundary-world';

const coworkerId = '30000000-0000-4000-8000-000000000021';
const sharedJobId = '8c000000-0000-4000-8000-000000000001';
const foreignJobId = '8c000000-0000-4000-8000-000000000002';
const coworkerInternalDraft = '8c000000-0000-4000-8000-000000000011';
const ownInternalDraft = '8c000000-0000-4000-8000-000000000012';
const coworkerCustomerDraft = '8c000000-0000-4000-8000-000000000013';
const foreignDraft = '8c000000-0000-4000-8000-000000000014';

type DraftSeed = {
  artifactId: string;
  organizationId: string;
  jobId: string;
  author: string;
  visibility: 'internal_only' | 'customer_facing';
};
const drafts: DraftSeed[] = [
  {
    artifactId: coworkerInternalDraft,
    organizationId: ORGANIZATION_A,
    jobId: sharedJobId,
    author: coworkerId,
    visibility: 'internal_only',
  },
  {
    artifactId: ownInternalDraft,
    organizationId: ORGANIZATION_A,
    jobId: sharedJobId,
    author: CALLER_ID,
    visibility: 'internal_only',
  },
  {
    artifactId: coworkerCustomerDraft,
    organizationId: ORGANIZATION_A,
    jobId: sharedJobId,
    author: coworkerId,
    visibility: 'customer_facing',
  },
  {
    artifactId: foreignDraft,
    organizationId: ORGANIZATION_B,
    jobId: foreignJobId,
    author: CALLER_ID,
    visibility: 'internal_only',
  },
];
// Each draft's revision id ends like its artifact id, with a different prefix.
const revisionOf = (artifactId: string) => artifactId.replace('8c000000', '8d000000');

installActionWorld({
  jobs: [
    {
      id: sharedJobId,
      organization_id: ORGANIZATION_A,
      project_id: null,
      title: 'Heizung',
      description: null,
      job_number: 'A-1',
    },
    {
      id: foreignJobId,
      organization_id: ORGANIZATION_B,
      project_id: null,
      title: 'Fremd',
      description: null,
      job_number: 'B-1',
    },
  ],
  job_assignments: [
    { organization_id: ORGANIZATION_A, job_id: sharedJobId, user_id: CALLER_ID },
    { organization_id: ORGANIZATION_A, job_id: sharedJobId, user_id: coworkerId },
    { organization_id: ORGANIZATION_B, job_id: foreignJobId, user_id: CALLER_ID },
  ],
  employee_records: [],
  work_artifacts: drafts.map((draft) => ({
    id: draft.artifactId,
    organization_id: draft.organizationId,
    job_id: draft.jobId,
    project_id: null,
    status: 'draft',
    kind: 'defect',
    current_revision_id: revisionOf(draft.artifactId),
    version: 1,
    updated_at: '2026-10-20T08:00:00.000Z',
  })),
  work_artifact_revisions: drafts.map((draft) => ({
    id: revisionOf(draft.artifactId),
    organization_id: draft.organizationId,
    artifact_id: draft.artifactId,
    title: 'Mangel',
    kind: 'defect',
    revision_number: 1,
    visibility: draft.visibility,
    created_by: draft.author,
  })),
  work_artifact_defect_details: drafts.map((draft) => ({
    revision_id: revisionOf(draft.artifactId),
    organization_id: draft.organizationId,
    due_date: '2026-01-05',
    severity: 'high',
    state: 'open',
    responsible_employee_record_id: null,
  })),
});
// No one holds the approval responsibility; the due-defect tasks do not depend on it.
mock.module('@/lib/responsibilities/server', () => ({
  getEffectiveResponsibilityHolderForActor: async () => null,
}));
const { deriveWorkArtifactTasks } = await import('@/lib/attention/work-tasks');

async function dueDefectArtifacts(role: ActionContext['role']): Promise<string[]> {
  const result = await deriveWorkArtifactTasks({
    userId: CALLER_ID,
    orgId: ORGANIZATION_A,
    role,
    isManagerOrAbove: role !== 'employee',
  });
  assert.equal(result.failed, false, `${role}: the derivation failed`);
  return result.tasks
    .filter((task) => task.sourceType === 'work_defect_due')
    .map((task) => task.sourceId)
    .toSorted();
}

assert.deepEqual(
  await dueDefectArtifacts('employee'),
  [ownInternalDraft, coworkerCustomerDraft].toSorted(),
  "a field worker's due defects include a coworker's internal draft",
);
for (const role of ['admin', 'buero'] as const) {
  assert.deepEqual(
    await dueDefectArtifacts(role),
    [coworkerInternalDraft, ownInternalDraft, coworkerCustomerDraft].toSorted(),
    `${role}: a manager misses a due defect of the own organization`,
  );
}
