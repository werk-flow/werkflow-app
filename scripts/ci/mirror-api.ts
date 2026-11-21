// The CI mirror's GitHub REST API as scripts/ci/mirror-executor.ts uses it, with the mirror's one
// fine-grained token (Contents, Workflows and Actions read and write, Metadata read). A failed call
// throws with its method, path and status, never the response body. Every list reads all its pages
// or throws.
import { z } from 'zod';

const runSchema = z.object({
  id: z.number().int().positive(),
  path: z.string(),
  head_sha: z.string(),
  head_branch: z.string().nullable(),
  event: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  run_attempt: z.number().int().positive(),
});
export type MirrorRun = z.infer<typeof runSchema>;

const jobSchema = z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() });
export type MirrorJob = z.infer<typeof jobSchema>;

const artifactSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  expired: z.boolean(),
  workflow_run: z.object({ id: z.number().int().positive() }).nullable().optional(),
});
type MirrorArtifact = z.infer<typeof artifactSchema>;

/** What the executor asks of the mirror. Tests give a fake of it. */
export type MirrorApi = {
  /** The commit `refs/heads/<branch>` names, or undefined when there is no such branch. */
  branchHead(branch: string): Promise<string | undefined>;
  /** The tree and committer date of a commit. */
  commit(sha: string): Promise<{ tree: string; committedAt: Date }>;
  /** The push runs of `branch` at `sha`. */
  runsOf(branch: string, sha: string): Promise<MirrorRun[]>;
  run(id: number): Promise<MirrorRun>;
  /** The jobs of a run's first attempt. */
  jobs(runId: number): Promise<MirrorJob[]>;
  artifacts(runId: number): Promise<MirrorArtifact[]>;
  /** An artifact's zip archive. */
  download(artifactId: number): Promise<Uint8Array>;
  cancel(runId: number): Promise<void>;
  /** Every branch under `ci/` with its commit. */
  ciBranches(): Promise<{ name: string; sha: string }[]>;
  /** Deletes a branch; a branch that is gone already is no failure. */
  deleteBranch(branch: string): Promise<void>;
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const PAGE = 100;
/** The longest one call or archive download may take. */
const CALL_LIMIT_MS = 60_000;
/** The most an artifact archive may hold: a job's result is a few kilobytes. */
const ARCHIVE_LIMIT = 4 * 1024 * 1024;

/** The REST client of `repository` (`owner/name`) with `token`; `fetch` is the network. */
export function githubMirrorApi(input: {
  repository: string;
  token: string;
  fetch?: Fetch;
  api?: string;
}): MirrorApi {
  const { repository, token } = input;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository))
    throw new Error('CI_MIRROR_REPO is no `owner/name`.');
  const send = input.fetch ?? ((url, init) => fetch(url, init));
  const api = input.api ?? 'https://api.github.com';
  const base = `/repos/${repository}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ci-mirror',
  };

  async function call(method: string, path: string, accept: readonly number[] = [200]): Promise<Response> {
    const response = await send(`${api}${base}${path}`, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(CALL_LIMIT_MS),
    });
    if (!accept.includes(response.status)) {
      await response.body?.cancel();
      throw new Error(`GitHub ${method} ${path.split('?')[0]} answered ${response.status}.`);
    }
    return response;
  }
  const json = async (path: string): Promise<unknown> => (await call('GET', path)).json();

  /** Every item of a paged list whose page holds `total_count` and the items under `key`. */
  async function every<T>(path: string, key: string, item: z.ZodType<T>): Promise<T[]> {
    const page = z.object({ total_count: z.number().int().nonnegative(), items: z.array(item) });
    const items: T[] = [];
    for (let number = 1; ; number += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const raw = await json(`${path}${separator}per_page=${PAGE}&page=${number}`);
      const answer = page.parse(
        typeof raw === 'object' && raw !== null && 'total_count' in raw && key in raw
          ? { total_count: raw.total_count, items: Object.entries(raw).find(([name]) => name === key)?.[1] }
          : raw,
      );
      const found = answer.items;
      items.push(...found);
      if (items.length >= answer.total_count || found.length < PAGE) {
        if (items.length < answer.total_count)
          throw new Error(`GitHub listed ${items.length} of ${answer.total_count} ${key}.`);
        return items;
      }
    }
  }

  const branchPath = (branch: string): string => branch.split('/').map(encodeURIComponent).join('/');

  async function branchHead(branch: string): Promise<string | undefined> {
    const response = await call('GET', `/git/ref/heads/${branchPath(branch)}`, [200, 404]);
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    return z.object({ object: z.object({ sha: z.string() }) }).parse(await response.json()).object.sha;
  }

  return {
    branchHead,
    async commit(sha) {
      const commit = z
        .object({ tree: z.object({ sha: z.string() }), committer: z.object({ date: z.string().datetime() }) })
        .parse(await json(`/git/commits/${encodeURIComponent(sha)}`));
      return { tree: commit.tree.sha, committedAt: new Date(commit.committer.date) };
    },
    runsOf: (branch, sha) =>
      every(
        `/actions/runs?event=push&branch=${encodeURIComponent(branch)}&head_sha=${encodeURIComponent(sha)}`,
        'workflow_runs',
        runSchema,
      ),
    run: async (id) => runSchema.parse(await json(`/actions/runs/${id}`)),
    jobs: (runId) => every(`/actions/runs/${runId}/attempts/1/jobs`, 'jobs', jobSchema),
    artifacts: (runId) => every(`/actions/runs/${runId}/artifacts`, 'artifacts', artifactSchema),
    async download(artifactId) {
      // GitHub answers with a short-lived address on its storage, which gets no token.
      const response = await call('GET', `/actions/artifacts/${artifactId}/zip`, [302]);
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location?.startsWith('https://')) throw new Error('GitHub named no archive address.');
      const archive = await send(location, {
        method: 'GET',
        headers: { 'User-Agent': 'ci-mirror' },
        signal: AbortSignal.timeout(CALL_LIMIT_MS),
      });
      if (archive.status !== 200 || !archive.body) {
        await archive.body?.cancel();
        throw new Error(`The artifact archive answered ${archive.status}.`);
      }
      // Read up to the limit and no further: a larger archive is no result.
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = archive.body.getReader();
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        size += read.value.byteLength;
        if (size > ARCHIVE_LIMIT) {
          await reader.cancel();
          throw new Error('The artifact archive is larger than a result.');
        }
        chunks.push(read.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    },
    async cancel(runId) {
      // 409: the run ended already.
      const response = await call('POST', `/actions/runs/${runId}/cancel`, [202, 409]);
      await response.body?.cancel();
    },
    async ciBranches() {
      const refs = z
        .array(z.object({ ref: z.string(), object: z.object({ sha: z.string() }) }))
        .parse(await json('/git/matching-refs/heads/ci/'));
      return refs.map((ref) => ({ name: ref.ref.replace(/^refs\/heads\//, ''), sha: ref.object.sha }));
    },
    async deleteBranch(branch) {
      // 422 also answers a refused delete: it counts only when the branch is gone.
      const response = await call('DELETE', `/git/refs/heads/${branchPath(branch)}`, [204, 404, 422]);
      await response.body?.cancel();
      if (response.status === 422 && (await branchHead(branch)) !== undefined)
        throw new Error(`GitHub DELETE /git/refs/heads/${branch} answered 422, and the branch stays.`);
    },
  };
}
