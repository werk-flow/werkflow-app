// The reference read a refused upload or export takes before it deletes its
// own copy. A version upload can archive that copy while the read runs: the
// key leaves `documents` and enters `document_versions` in one commit. Here the
// database answers an archived-version read before that commit and a
// current-document read after it, as two separate reads can. The copy stays;
// an unreferenced copy is removed.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

type Row = Record<string, unknown>;
type QueryResult = { data: Row[]; error: null };

const organizationId = '20000000-0000-4000-8000-00000000000a';
const documentFolder = `${organizationId}/8e000000-0000-4000-8000-000000000001/`;
const copyPath = `${documentFolder}copy-vertrag.pdf`;
const unreferencedPath = `${documentFolder}copy-angebot.pdf`;
const tables: Record<string, Row[]> = {
  documents: [{ id: 'document', organization_id: organizationId, storage_path: copyPath }],
  document_versions: [],
};
let versionUploadPending = true;
// The version upload's commit: the copy becomes version 1, a new key becomes current.
function commitVersionUpload(): void {
  versionUploadPending = false;
  tables.document_versions = [{ id: 'version-1', organization_id: organizationId, storage_path: copyPath }];
  tables.documents = [
    {
      id: 'document',
      organization_id: organizationId,
      storage_path: `${documentFolder}versions/2-vertrag.pdf`,
    },
  ];
}

// A current-document read answers a few turns after an archived-version read issued with it.
const ANSWER_TURNS: Record<string, number> = { documents: 3, document_versions: 1 };
function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const answer = (): QueryResult => {
    const data = (tables[table] ?? []).filter((row) =>
      filters.every(([column, value]) => row[column] === value),
    );
    if (table === 'document_versions' && versionUploadPending) commitVersionUpload();
    return { data, error: null };
  };
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    limit: () => query,
    then: <Fulfilled>(onFulfilled: (result: QueryResult) => Fulfilled) => {
      let turns = Promise.resolve();
      for (let turn = 0; turn < (ANSWER_TURNS[table] ?? 1); turn += 1) turns = turns.then(() => undefined);
      return turns.then(answer).then(onFulfilled);
    },
  };
  return query;
}

const discardedPaths: string[] = [];
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ from }) }));
mock.module('@/lib/storage/r2', () => ({
  discardStorageObjects: async ({ paths }: { paths: string[] }) => {
    discardedPaths.push(...paths);
  },
}));
const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
const { discardUnreferencedObject } = await import('@/lib/documents/storage-references');

await discardUnreferencedObject(
  createSupabaseAdminClient(),
  organizationId,
  copyPath,
  'fixture: reference read',
);
assert.deepEqual(
  discardedPaths,
  [],
  'a refused attempt removed a copy a version upload archived during its read',
);

await discardUnreferencedObject(
  createSupabaseAdminClient(),
  organizationId,
  unreferencedPath,
  'fixture: reference read',
);
assert.deepEqual(discardedPaths, [unreferencedPath], 'an unreferenced copy was kept');
