// The actual purge route and purge over an in-memory queue and bucket; only
// the database functions and the bucket are replaced. Without the cron secret
// nothing runs. The purge deletes exactly the paths the claim returns, each
// organization's inside its own prefix, completes only what it deleted, and
// keeps a failed deletion queued while the route answers a server error. No
// path or provider message reaches a log (werk-flow/werkflow-planning#286).
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import * as nextServer from 'next/server';

const secret = 'synthetic-cron-secret-0123456789abcdef';
const ORGANIZATION_A = '28600000-0000-4000-8000-00000000000a';
const ORGANIZATION_B = '28600000-0000-4000-8000-00000000000b';
const privatePath = `${ORGANIZATION_A}/d1/Kündigung Erika Mustermann.pdf`;

type Entry = { id: string; organization_id: string; storage_path: string; claimed: boolean };
let queue: Entry[] = [];
const bucket = new Set<string>();
const deleteRequests: { organizationId: string; paths: readonly string[] }[] = [];
let failingOrganization: string | null = null;
let failClaim = false;
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

mock.module('server-only', () => ({}));
mock.module('next/server', () => ({ ...nextServer, connection: async () => {} }));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_storage_purge') {
        if (failClaim) return { data: null, error: { code: 'PGRST000', message: privatePath } };
        assert.equal(typeof args.p_limit, 'number');
        // Like the function: a claimed entry is not claimed again in the same run.
        const due = queue.filter((entry) => !entry.claimed).slice(0, 2);
        for (const entry of due) entry.claimed = true;
        return {
          data: due.map(({ id, organization_id, storage_path }) => ({ id, organization_id, storage_path })),
          error: null,
        };
      }
      if (name === 'complete_storage_purge') {
        const ids = args.p_ids;
        assert.ok(Array.isArray(ids));
        queue = queue.filter((entry) => !ids.includes(entry.id));
        return { data: null, error: null };
      }
      throw new Error(`unexpected function ${name}`);
    },
  }),
}));
mock.module('@/lib/storage/r2', () => ({
  deleteStorageObjects: async ({
    organizationId,
    paths,
  }: {
    organizationId: string;
    paths: readonly string[];
  }) => {
    deleteRequests.push({ organizationId, paths });
    for (const path of paths)
      assert.ok(path.startsWith(`${organizationId}/`), 'a path left its organization');
    if (organizationId === failingOrganization) throw new Error(`could not delete ${paths.join(', ')}`);
    for (const path of paths) bucket.delete(path);
  },
}));

const { GET } = await import('../../../app/api/storage-purge/route');
const request = (authorization?: string) =>
  new Request('https://app.example.test/api/storage-purge', {
    headers: authorization ? { authorization } : {},
  });

const fill = (): void => {
  queue = [
    { id: 'e1', organization_id: ORGANIZATION_A, storage_path: privatePath, claimed: false },
    {
      id: 'e2',
      organization_id: ORGANIZATION_B,
      storage_path: `${ORGANIZATION_B}/d2/foto.jpg`,
      claimed: false,
    },
    {
      id: 'e3',
      organization_id: ORGANIZATION_A,
      storage_path: `${ORGANIZATION_A}/staging/x.pdf`,
      claimed: false,
    },
  ];
  bucket.clear();
  for (const entry of queue) bucket.add(entry.storage_path);
  bucket.add(`${ORGANIZATION_A}/d9/behalten.pdf`);
  deleteRequests.length = 0;
};

// Without a configured secret nothing runs, and the operator sees a server error.
fill();
delete process.env.CRON_SECRET;
assert.equal((await GET(request(`Bearer ${secret}`))).status, 503);
process.env.CRON_SECRET = 'too-short';
assert.equal((await GET(request('Bearer too-short'))).status, 503, 'a placeholder secret opened the purge');
assert.equal(deleteRequests.length, 0, 'an unconfigured purge deleted objects');

// A request without the secret, or with another one, finds no route.
process.env.CRON_SECRET = secret;
for (const authorization of [undefined, 'Bearer wrong', secret, `Bearer ${secret}x`]) {
  assert.equal((await GET(request(authorization))).status, 404, `${authorization} reached the purge`);
}
assert.equal(deleteRequests.length, 0, 'a refused request deleted objects');
assert.equal(queue.length, 3);

// The purge deletes exactly the claimed paths, per organization, and completes them.
const done = await GET(request(`Bearer ${secret}`));
assert.equal(done.status, 200);
assert.deepEqual(await done.json(), { ok: true, purged: 3, failed: 0 });
assert.deepEqual(
  [...bucket],
  [`${ORGANIZATION_A}/d9/behalten.pdf`],
  'the purge deleted other objects than the claimed',
);
assert.equal(queue.length, 0, 'a deleted object stayed queued');
assert.ok(
  deleteRequests.every((request) => request.paths.length > 0),
  'the purge sent an empty delete request',
);

// A failed deletion stays queued and the route answers a server error with counts only.
fill();
failingOrganization = ORGANIZATION_A;
const failed = await GET(request(`Bearer ${secret}`));
assert.equal(failed.status, 500);
const failedBody = await failed.text();
assert.deepEqual(JSON.parse(failedBody), { ok: false, purged: 1, failed: 2 });
assert.deepEqual(
  queue.map((entry) => entry.id),
  ['e1', 'e3'],
  'a failed deletion left the queue',
);
assert.ok(bucket.has(privatePath), 'the failed deletion still removed the object');
failingOrganization = null;

// A failed claim answers a server error too.
fill();
failClaim = true;
assert.equal((await GET(request(`Bearer ${secret}`))).status, 500);
failClaim = false;

assert.ok(logged.length > 0, 'a failure was not logged');
for (const line of logged) {
  assert.ok(
    !line.includes('Mustermann') && !line.includes(ORGANIZATION_A),
    `a log line names a path: ${line}`,
  );
}
assert.ok(!failedBody.includes('Mustermann'), 'the response names a path');
