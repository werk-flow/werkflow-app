import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from '@/lib/zod';
import pin from './wholesaler-reader-pin.json';

// Places the private wholesaler-file reader where lib/inventory/wholesaler-reader.ts
// imports it: the git-ignored vendor/wholesaler-reader/src/. `bun install` runs it
// (scripts/fetch-wholesaler-reader.ts).
//
// With a key it downloads the reader's source at the commit in wholesaler-reader-pin.json
// and nothing else. Without one it writes a stand-in that says no reader is installed;
// a Vercel production or preview build refuses that and fails instead of shipping without
// the reader. The key reaches GitHub in a header only: it is never logged or written.
//
// To move the pin: merge in the reader's repository, put its commit in the pin file, run
// `bun scripts/fetch-wholesaler-reader.ts --github-login`, then `bun run typecheck`.
//
// Temporary (werk-flow/werkflow-planning#395): when this repository becomes private, the
// reader moves into it and this module, its script and the pin are deleted.

const VENDOR = join('vendor', 'wholesaler-reader');
const STAND_IN_PATH = 'src/index.ts';
const STAND_IN = `// Written by \`bun install\` (scripts/fetch-wholesaler-reader.ts) without the reader's key:
// no wholesaler-file reader is installed here (docs/technical/environments.md#credentials).
export const readDelivery = undefined;
`;
/** A source file directly in the reader's src/; its tests stay behind. */
const SOURCE_FILE = /^src\/[a-z0-9-]+\.ts$/;
const TEST_FILE = /\.test\.ts$/;
const FULL_COMMIT = /^[0-9a-f]{40}$/;

const commitSchema = z.object({ sha: z.string(), tree: z.object({ sha: z.string() }) });
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })),
});

/** A failure whose message names the cause and never carries the key. */
class ReaderInstallError extends Error {}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type InstallOptions = {
  root: string;
  env: Readonly<Record<string, string | undefined>>;
  /** The machine's GitHub login, passed only when the caller asked for it with an explicit flag. */
  githubLogin?: (() => string) | undefined;
  fetch: Fetch;
};

export type ReaderInstall = { kind: 'reader'; repository: string; commit: string } | { kind: 'stand-in' };

export async function installWholesalerReader(options: InstallOptions): Promise<ReaderInstall> {
  const token = options.env.WERKFLOW_DATANORM_TOKEN?.trim() || options.githubLogin?.().trim();
  if (!token) {
    if (isVercelDeployment(options.env))
      throw new ReaderInstallError(
        'WERKFLOW_DATANORM_TOKEN is not set. A Vercel production or preview build needs the wholesaler-file reader: set the variable in the Vercel project (docs/technical/environments.md#credentials).',
      );
    replaceVendor(options.root, { [STAND_IN_PATH]: STAND_IN });
    return { kind: 'stand-in' };
  }
  replaceVendor(options.root, await downloadReader(token, options.fetch));
  return { kind: 'reader', repository: pin.repository, commit: pin.commit };
}

function isVercelDeployment(env: InstallOptions['env']): boolean {
  return env.VERCEL === '1' && (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview');
}

/** The reader's source files at the pinned commit, by path. GitHub's Git data API takes a SHA only, never a branch. */
async function downloadReader(token: string, fetch: Fetch): Promise<Record<string, string>> {
  if (!FULL_COMMIT.test(pin.commit))
    throw new ReaderInstallError('lib/inventory/wholesaler-reader-pin.json must name a full commit SHA.');
  const get = async (path: string, accept: string): Promise<Response> => {
    const url = `https://api.github.com/repos/${pin.repository}/${path}`;
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'User-Agent': 'werkflow-app-build',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }).catch(() => {
      throw new ReaderInstallError(`GitHub did not answer the request for ${path}.`);
    });
    if (!response.ok)
      throw new ReaderInstallError(
        `GitHub answered ${response.status} for ${path}: the key cannot read ${pin.repository}, or the commit is not there.`,
      );
    return response;
  };
  const parsed = <T>(schema: z.ZodType<T>, body: unknown, what: string): T => {
    const result = schema.safeParse(body);
    if (!result.success) throw new ReaderInstallError(`GitHub's answer for ${what} has an unexpected shape.`);
    return result.data;
  };
  const json = 'application/vnd.github+json';

  const commit = parsed(
    commitSchema,
    await (await get(`git/commits/${pin.commit}`, json)).json(),
    'the commit',
  );
  if (commit.sha !== pin.commit)
    throw new ReaderInstallError(`GitHub returned commit ${commit.sha} instead of the pinned ${pin.commit}.`);
  const tree = parsed(
    treeSchema,
    await (await get(`git/trees/${commit.tree.sha}?recursive=1`, json)).json(),
    'the file tree',
  );
  if (tree.truncated) throw new ReaderInstallError('GitHub returned a truncated file tree of the reader.');
  const sources = tree.tree.filter(
    (entry) => entry.type === 'blob' && SOURCE_FILE.test(entry.path) && !TEST_FILE.test(entry.path),
  );
  if (!sources.some((entry) => entry.path === STAND_IN_PATH))
    throw new ReaderInstallError(`The pinned commit has no ${STAND_IN_PATH}.`);
  const files: Record<string, string> = {};
  for (const entry of sources)
    files[entry.path] = await (await get(`git/blobs/${entry.sha}`, 'application/vnd.github.raw+json')).text();
  return files;
}

/** Replaces the vendor folder as a whole, so a failed write never leaves a mix of two installs. */
function replaceVendor(root: string, files: Record<string, string>): void {
  const target = join(root, VENDOR);
  const staging = `${target}.partial`;
  rmSync(staging, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(staging, path)), { recursive: true });
    writeFileSync(join(staging, path), text);
  }
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
}
