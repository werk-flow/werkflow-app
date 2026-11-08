// The actual handover release over the in-memory database and an in-memory
// bucket behind the actual storage adapter. Each release attempt stores its
// package under a key of its own. A parallel release that the database
// refuses, after a release of the same content committed, removes only its own
// object, never the registered package. A replay of the committed release
// answers with the registered package and leaves no object of its own behind.
// A release with an unknown outcome keeps its object.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { installInMemoryBucket } from './in-memory-bucket';

const writes: string[] = [];
const bucket = installInMemoryBucket(writes);

const jobId = '87000000-0000-4000-8000-000000000001';
const packageId = '87000000-0000-4000-8000-000000000002';
const sourceDocumentId = '87000000-0000-4000-8000-000000000003';
const releaseId = '87000000-0000-4000-8000-000000000004';
const committedRequestId = '87000000-0000-4000-8000-000000000005';
const committedDocumentId = '87000000-0000-4000-8000-000000000006';
const sourceStoragePath = `${ORGANIZATION_A}/${sourceDocumentId}/pruefprotokoll.pdf`;

// The tables stay as every attempt read them: no commit reaches a later attempt's read.
const world = installActionWorld({
  employee_records: [
    {
      id: '87000000-0000-4000-8000-0000000000e1',
      organization_id: ORGANIZATION_A,
      user_id: CALLER_ID,
      exit_date: null,
      personnel_access_lifecycles: [],
      personnel_onboarding_requirements: [],
    },
  ],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'admin' }],
  work_handover_draft_items: [
    {
      id: '87000000-0000-4000-8000-000000000007',
      organization_id: ORGANIZATION_A,
      package_id: packageId,
      source_kind: 'document_version',
      work_artifact_revision_id: null,
      document_id: sourceDocumentId,
      document_version_number: 1,
      document_storage_path: sourceStoragePath,
      child_handover_release_id: null,
      customer_label: 'Prüfprotokoll',
      sort_order: 0,
    },
  ],
  work_handover_releases: [],
  work_handover_events: [],
  documents: [],
});

// The basis and the frozen summaries have their own reads; the release reads them as stated here.
const workspace = await import('@/lib/work-handover/workspace');
const targetSnapshot = {
  targetType: 'job' as const,
  targetId: jobId,
  number: 'A-100',
  title: 'Heizungswartung',
  customerName: null,
  contactName: null,
  contactRole: null,
  contactEmail: null,
  contactPhone: null,
  siteName: null,
  siteAddress: null,
};
mock.module('@/lib/work-handover/workspace', () => ({
  ...workspace,
  loadWorkspaceBasis: async () => ({
    target: {
      snapshot: targetSnapshot,
      executionState: 'execution_complete',
      executionVersion: 3,
      projectJobIds: [],
    },
    handoverPackage: {
      id: packageId,
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      project_id: null,
      state: 'draft',
      version: 2,
      current_release_id: null,
    },
    gate: { fingerprint: 'c'.repeat(64), snapshot: {} },
    sources: [
      {
        key: `document:${sourceDocumentId}:1`,
        kind: 'document_version',
        label: 'Prüfprotokoll',
        description: 'Dokument',
        workArtifactRevisionId: null,
        documentId: sourceDocumentId,
        documentVersionNumber: 1,
        documentStoragePath: sourceStoragePath,
        childHandoverReleaseId: null,
        customerPayload: { Dokument: 'Prüfprotokoll' },
      },
    ],
  }),
}));
mock.module('@/lib/work-handover/summaries', () => ({
  loadFrozenSummaries: async () => ({ timeSummary: {}, materialSummary: {} }),
}));

const { previewWorkHandover, releaseWorkHandover } = await import('@/lib/work-handover/actions');

signInAs(world, 'admin');
const target = {
  targetType: 'job' as const,
  targetId: jobId,
  packageId,
  expectedPackageVersion: 2,
  releaseId,
};
const preview = await previewWorkHandover(target);
assert.ok(preview.success, JSON.stringify(preview));
const release = (requestId: string, documentId: string) =>
  releaseWorkHandover({
    ...target,
    requestId,
    documentId,
    documentLinkId: crypto.randomUUID(),
    expectedExecutionVersion: 3,
    expectedContentHash: preview.contentHash,
    reason: 'Übergabe an Kunden',
    overrideGates: false,
  });
const releaseCalls = () => world.rpcCalls.filter((call) => call.name === 'release_work_handover');
const storagePathOfCall = (index: number) => String(releaseCalls()[index]?.args.p_storage_path);
const packageKeys = () => [...bucket.keys()].filter((key) => key.includes('/work-handover-packages/'));

// The first release commits and registers its package.
world.rpc = ({ name, args }) =>
  name === 'release_work_handover'
    ? { data: { releaseId, documentId: args.p_document_id, duplicate: false }, error: null }
    : { data: null, error: { message: `${name} is outside this fixture` } };
assert.deepEqual(await release(committedRequestId, committedDocumentId), {
  success: true,
  releaseId,
  documentId: committedDocumentId,
});
const registeredPath = storagePathOfCall(0);
assert.deepEqual(packageKeys(), [registeredPath]);

// A parallel release of the same content read the package before the first
// committed. The database refuses it: it removes only the object it stored.
world.rpc = () => ({ data: null, error: { code: 'P0001', message: 'work_handover_stale_version' } });
assert.deepEqual(await release(crypto.randomUUID(), crypto.randomUUID()), {
  success: false,
  error: 'work_handover_stale_version',
});
assert.ok(
  !writes.includes(`delete ${registeredPath}`),
  'a refused release removed the package a committed release registered',
);
const refusedPath = storagePathOfCall(1);
assert.notEqual(refusedPath, registeredPath, 'two release attempts stored one key');
assert.deepEqual(packageKeys(), [registeredPath]);

// A replay of the committed request whose reads, like the refused attempt's,
// were taken before the commit: the database answers it as a duplicate, and it
// answers with the registered package and removes the object it stored. A
// retry that reads after the commit is refused as stale before it stores
// anything.
world.rpc = () => ({ data: { releaseId, documentId: committedDocumentId, duplicate: true }, error: null });
assert.deepEqual(await release(committedRequestId, crypto.randomUUID()), {
  success: true,
  releaseId,
  documentId: committedDocumentId,
});
const replayPath = storagePathOfCall(2);
assert.notEqual(replayPath, registeredPath, 'a replay stored the registered key again');
assert.deepEqual(packageKeys(), [registeredPath]);

// A release whose registration has an unknown outcome keeps its object.
world.rpc = () => ({ data: null, error: { code: '', message: 'TypeError: fetch failed' } });
assert.equal((await release(crypto.randomUUID(), crypto.randomUUID())).success, false);
const unknownPath = storagePathOfCall(3);
assert.deepEqual(writes, [
  `put ${registeredPath}`,
  `put ${refusedPath}`,
  `delete ${refusedPath}`,
  `put ${replayPath}`,
  `delete ${replayPath}`,
  `put ${unknownPath}`,
]);
