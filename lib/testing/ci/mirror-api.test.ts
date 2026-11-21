// The CI mirror's REST client (scripts/ci/mirror-api.ts) against a fake network: the token goes to
// GitHub's API only, never to the archive address an artifact redirects to; a list reads every page
// or throws; a failed call names its status, never the body; a branch that is gone is no failure.
import { expect, test } from 'bun:test';
import { githubMirrorApi } from '../../../scripts/ci/mirror-api';

type Sent = { url: string; init: RequestInit };

function network(answer: (url: string, init: RequestInit) => Response): {
  sent: Sent[];
  fetch: (url: string, init: RequestInit) => Promise<Response>;
} {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, init });
      return answer(url, init);
    },
  };
}

const headerOf = (init: RequestInit, name: string): string | undefined =>
  Object.entries(init.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

test("an artifact's archive is fetched from its redirect without the token", async () => {
  const net = network((url) =>
    url.endsWith('/zip')
      ? new Response(null, { status: 302, headers: { location: 'https://storage.example/archive?sig=1' } })
      : new Response(new Uint8Array([80, 75, 5, 6]), { status: 200 }),
  );
  const api = githubMirrorApi({ repository: 'owner/mirror', token: 'mirror-token', fetch: net.fetch });
  expect(await api.download(42)).toEqual(new Uint8Array([80, 75, 5, 6]));
  expect(net.sent.map((call) => call.url)).toEqual([
    'https://api.github.com/repos/owner/mirror/actions/artifacts/42/zip',
    'https://storage.example/archive?sig=1',
  ]);
  expect(headerOf(net.sent[0]?.init ?? {}, 'authorization')).toBe('Bearer mirror-token');
  expect(net.sent[0]?.init.redirect).toBe('manual');
  expect(headerOf(net.sent[1]?.init ?? {}, 'authorization')).toBeUndefined();
});

test('a list reads every page, and one that holds fewer items than GitHub counts throws', async () => {
  const job = (index: number) => ({ name: `Job ${index}`, status: 'completed', conclusion: 'skipped' });
  const pages = network((url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    const jobs = page === 1 ? Array.from({ length: 100 }, (_, index) => job(index)) : [job(100)];
    return Response.json({ total_count: 101, jobs });
  });
  const api = githubMirrorApi({ repository: 'owner/mirror', token: 't', fetch: pages.fetch });
  expect((await api.jobs(9)).length).toBe(101);
  const short = network(() => Response.json({ total_count: 3, jobs: [job(1)] }));
  await expect(
    githubMirrorApi({ repository: 'owner/mirror', token: 't', fetch: short.fetch }).jobs(9),
  ).rejects.toThrow('listed 1 of 3 jobs');
});

test('a failed call names its method, path and status, never the body; a deleted branch that is gone passes', async () => {
  const net = network((url, init) =>
    init.method === 'DELETE'
      ? new Response('{"message":"Reference does not exist"}', { status: 422 })
      : url.includes('/git/ref/')
        ? new Response('{"message":"Not Found"}', { status: 404 })
        : new Response('{"message":"secret detail"}', { status: 500 }),
  );
  const api = githubMirrorApi({ repository: 'owner/mirror', token: 't', fetch: net.fetch });
  await api.deleteBranch(`ci/${'c'.repeat(40)}-a1/sql`);
  const failure = await api.run(5).then(
    () => 'no failure',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  expect(failure).toBe('GitHub GET /actions/runs/5 answered 500.');
  expect(() => githubMirrorApi({ repository: 'not a repository', token: 't' })).toThrow('owner/name');
});

test('an archive larger than a result is refused while it streams, never held whole', async () => {
  let sent = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1024 * 1024;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const net = network((url) =>
    url.endsWith('/zip')
      ? new Response(null, { status: 302, headers: { location: 'https://storage.example/archive' } })
      : new Response(endless, { status: 200 }),
  );
  const api = githubMirrorApi({ repository: 'owner/mirror', token: 't', fetch: net.fetch });
  await expect(api.download(1)).rejects.toThrow('larger than a result');
  expect(sent).toBeLessThan(16 * 1024 * 1024);
});

test('a refused delete that leaves the branch in place is a failure, not a sweep', async () => {
  const net = network((_url, init) =>
    init.method === 'DELETE'
      ? new Response('{"message":"Validation Failed"}', { status: 422 })
      : Response.json({ object: { sha: 'c'.repeat(40) } }),
  );
  const api = githubMirrorApi({ repository: 'owner/mirror', token: 't', fetch: net.fetch });
  await expect(api.deleteBranch('ci/x/sql')).rejects.toThrow('answered 422, and the branch stays');
});
