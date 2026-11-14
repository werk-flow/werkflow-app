// Rule test: `bun install` places the wholesaler-file reader only from its pinned commit, writes a stand-in without a key,
// fails a Vercel production or preview build without the reader, and never shows the key.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pin from './wholesaler-reader-pin.json';
import { installWholesalerReader } from './wholesaler-reader-install';

const KEY = 'github_pat_synthetic_key_0123456789';
const API = `https://api.github.com/repos/${pin.repository}/`;
const SOURCE = join('vendor', 'wholesaler-reader', 'src');

type FakeGitHub = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  requests: { url: string; authorization: string | null }[];
};

/** A synthetic Git SHA: 40 hex digits. */
const sha = (digit: string): string => digit.repeat(40);
const TREE = sha('1');
const INDEX_BLOB = sha('2');
const READER_BLOB = sha('3');

/** GitHub's Git data API for a synthetic reader: the pinned commit, its tree and blobs. */
function fakeGitHub(
  answer: {
    commitSha?: string;
    /** A commit answer that is not JSON, as a proxy or a broken answer may send. */
    commitBody?: string;
    blobSha?: string;
    status?: number;
    truncated?: boolean;
    unreachable?: boolean;
  } = {},
) {
  const tree = [
    { path: 'src', type: 'tree', sha: sha('4') },
    { path: 'src/index.ts', type: 'blob', sha: INDEX_BLOB },
    { path: 'src/reader.ts', type: 'blob', sha: answer.blobSha ?? READER_BLOB },
    { path: 'src/reader.test.ts', type: 'blob', sha: sha('5') },
    { path: 'src/nested/deep.ts', type: 'blob', sha: sha('6') },
    { path: 'README.md', type: 'blob', sha: sha('7') },
  ];
  const blobs: Record<string, string> = {
    [INDEX_BLOB]: "export { readDelivery } from './reader';\n",
    [READER_BLOB]: 'export const readDelivery = () => null;\n',
  };
  const github: FakeGitHub = {
    requests: [],
    fetch: async (url, init) => {
      github.requests.push({ url, authorization: new Headers(init.headers).get('Authorization') });
      if (answer.unreachable) throw new TypeError(`fetch failed for ${url}`);
      if (answer.status)
        return new Response(`{"message":"Bad credentials ${KEY}"}`, { status: answer.status });
      const path = url.slice(API.length);
      if (path === `git/commits/${pin.commit}` && answer.commitBody !== undefined)
        return new Response(answer.commitBody);
      if (path === `git/commits/${pin.commit}`)
        return Response.json({ sha: answer.commitSha ?? pin.commit, tree: { sha: TREE } });
      if (path === `git/trees/${TREE}?recursive=1`)
        return Response.json({ truncated: answer.truncated ?? false, tree });
      const blob = blobs[path.replace('git/blobs/', '')];
      return blob === undefined ? new Response('', { status: 404 }) : new Response(blob);
    },
  };
  return github;
}

function checkout(): string {
  return mkdtempSync(join(tmpdir(), 'werkflow-wholesaler-reader-'));
}

async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('The install did not fail.');
}

test('without a key every machine except a Vercel deployment gets the stand-in, and it reports no reader', async () => {
  for (const env of [
    {},
    { CI: 'true' },
    { VERCEL: '1', VERCEL_ENV: 'development' },
    { WERKFLOW_DATANORM_TOKEN: ' ' },
  ]) {
    const root = checkout();
    try {
      // A reader from an earlier install with a key does not survive an install without one.
      mkdirSync(join(root, SOURCE), { recursive: true });
      writeFileSync(join(root, SOURCE, 'reader.ts'), 'export {};\n');
      const github = fakeGitHub();
      expect(await installWholesalerReader({ root, env, fetch: github.fetch })).toEqual({ kind: 'stand-in' });
      expect(github.requests).toEqual([]);
      expect(readdirSync(join(root, SOURCE))).toEqual(['index.ts']);
      expect(await import(join(root, SOURCE, 'index.ts'))).toMatchObject({ readDelivery: undefined });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a Vercel production or preview build without a key fails and installs nothing', async () => {
  for (const VERCEL_ENV of ['production', 'preview']) {
    const root = checkout();
    try {
      const message = await failure(
        installWholesalerReader({ root, env: { VERCEL: '1', VERCEL_ENV }, fetch: fakeGitHub().fetch }),
      );
      expect(message).toContain('WERKFLOW_DATANORM_TOKEN is not set');
      expect(existsSync(join(root, 'vendor'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('the install script exits non-zero on a Vercel production build without a key', () => {
  // An empty variable is no key, as Vercel leaves it when the value was never set.
  const env = { ...process.env, VERCEL: '1', VERCEL_ENV: 'production', WERKFLOW_DATANORM_TOKEN: '' };
  const script = resolve(import.meta.dir, '../../scripts/fetch-wholesaler-reader.ts');
  const run = spawnSync('bun', [script], {
    env,
    encoding: 'utf8',
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('WERKFLOW_DATANORM_TOKEN is not set');
});

test("a key installs the reader's source files at the pinned commit, without its tests", async () => {
  const root = checkout();
  try {
    const github = fakeGitHub();
    const install = await installWholesalerReader({
      root,
      env: { VERCEL: '1', VERCEL_ENV: 'production', WERKFLOW_DATANORM_TOKEN: KEY },
      fetch: github.fetch,
    });
    expect(install).toEqual({ kind: 'reader', repository: pin.repository, commit: pin.commit });
    expect(readdirSync(join(root, SOURCE)).sort()).toEqual(['index.ts', 'reader.ts']);
    expect(github.requests.map((request) => request.url.slice(API.length))).toEqual([
      `git/commits/${pin.commit}`,
      `git/trees/${TREE}?recursive=1`,
      `git/blobs/${INDEX_BLOB}`,
      `git/blobs/${READER_BLOB}`,
    ]);
    expect(github.requests.every((request) => request.url.startsWith(API))).toBe(true);
    expect(existsSync(join(root, 'vendor', 'wholesaler-reader.partial'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an answer for another commit, with a malformed SHA or a truncated tree, or a failed request, is refused and keeps the earlier install', async () => {
  for (const answer of [
    { commitSha: sha('f') },
    // An answer whose SHAs carry other text, here the key, never reaches a URL or a message.
    { commitSha: KEY },
    { blobSha: KEY },
    // A parse error quotes the body, so no parse error is ever shown.
    { commitBody: `{"sha": ${KEY}}` },
    { truncated: true },
    { status: 401 },
    { unreachable: true },
  ]) {
    const root = checkout();
    try {
      await installWholesalerReader({ root, env: {}, fetch: fakeGitHub().fetch });
      const github = fakeGitHub(answer);
      const message = await failure(
        installWholesalerReader({ root, env: { WERKFLOW_DATANORM_TOKEN: KEY }, fetch: github.fetch }),
      );
      expect(message.length).toBeGreaterThan(0);
      expect(github.requests.some((request) => request.url.includes('git/blobs/'))).toBe(false);
      expect(readdirSync(join(root, SOURCE))).toEqual(['index.ts']);
      expect(await import(join(root, SOURCE, 'index.ts'))).toMatchObject({ readDelivery: undefined });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('the key reaches GitHub in the Authorization header only and appears in no outcome or message', async () => {
  const shown: string[] = [];
  for (const answer of [
    {},
    { commitSha: sha('f') },
    // An answer whose SHAs carry other text, here the key, never reaches a URL or a message.
    { commitSha: KEY },
    { blobSha: KEY },
    // A parse error quotes the body, so no parse error is ever shown.
    { commitBody: `{"sha": ${KEY}}` },
    { truncated: true },
    { status: 401 },
    { unreachable: true },
  ]) {
    const root = checkout();
    try {
      const github = fakeGitHub(answer);
      const run = installWholesalerReader({
        root,
        env: { WERKFLOW_DATANORM_TOKEN: KEY },
        fetch: github.fetch,
      });
      shown.push(Object.keys(answer).length === 0 ? JSON.stringify(await run) : await failure(run));
      for (const request of github.requests) {
        expect(request.url).not.toContain(KEY);
        expect(request.authorization).toBe(`Bearer ${KEY}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  expect(shown).toHaveLength(8);
  for (const text of shown) expect(text).not.toContain(KEY);
});

test("the machine's GitHub login is read only when asked for and no key variable is set", async () => {
  const root = checkout();
  try {
    let logins = 0;
    const githubLogin = () => {
      logins += 1;
      return `${KEY}\n`;
    };
    const github = fakeGitHub();
    await installWholesalerReader({
      root,
      env: { WERKFLOW_DATANORM_TOKEN: 'variable-key' },
      githubLogin,
      fetch: github.fetch,
    });
    expect(logins).toBe(0);
    expect(github.requests[0]?.authorization).toBe('Bearer variable-key');
    const withLogin = fakeGitHub();
    await installWholesalerReader({ root, env: {}, githubLogin, fetch: withLogin.fetch });
    expect(logins).toBe(1);
    expect(withLogin.requests[0]?.authorization).toBe(`Bearer ${KEY}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
