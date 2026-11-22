// The tree sync of the CI mirror (scripts/ci/mirror-executor.ts): one parentless commit of a source
// commit's tree, by a neutral identity, pushed to a `ci/**` branch of the mirror. The pushed tree
// holds exactly one workflow, the mirror's own, from the orchestrator's trusted copy: every source
// workflow moves to .github/held-workflows/, where the tests and tools that read workflows find it
// through CI_WORKFLOWS_DIR. The commit is built with git's plumbing in the orchestrator's clone,
// whose objects a later push of the same tree reuses, under an index of its own.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELD_WORKFLOWS, MIRROR_WORKFLOW } from '../../lib/testing/ci/mirror';

const SOURCE_WORKFLOWS = '.github/workflows';
const GIT_LIMIT_MS = 10 * 60_000;

/** The mirror commit's author and committer. */
export type MirrorIdentity = { name: string; email: string };

/** A neutral identity on a reserved domain, which names no person and no organization. */
export const DEFAULT_MIRROR_IDENTITY: MirrorIdentity = { name: 'CI mirror', email: 'ci-mirror@ci.invalid' };

/**
 * The identity CI_MIRROR_IDENTITY names (`Name <email>`), the default when unset. Throws for a
 * malformed one, or one that names WerkFlow.
 */
export function mirrorIdentity(value: string | undefined): MirrorIdentity {
  if (!value) return DEFAULT_MIRROR_IDENTITY;
  const match = /^([^<>\n]+?) <([^<>\s@]+@[^<>\s@]+)>$/.exec(value.trim());
  if (!match?.[1] || !match[2]) throw new Error('CI_MIRROR_IDENTITY is no `Name <email>`.');
  if (/werk.?flow/i.test(value))
    throw new Error('CI_MIRROR_IDENTITY names WerkFlow; the mirror stays unlinked.');
  return { name: match[1], email: match[2] };
}

function git(
  repository: string,
  args: readonly string[],
  options: { env?: Readonly<Record<string, string>>; input?: string; quiet?: boolean } = {},
): string {
  const ran = spawnSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    // A push of the whole tree takes a minute or two; no git call here waits longer.
    timeout: GIT_LIMIT_MS,
  });
  if (ran.status !== 0) {
    const command = args.find((arg) => !arg.startsWith('-') && !arg.includes('=')) ?? '';
    // A push's own output stays out of the error: it talks to a remote that holds the token.
    const said = options.quiet ? '' : `: ${ran.stderr.trim().split('\n').at(-1) ?? ''}`;
    throw new Error(`git ${command} failed (${ran.status ?? ran.signal})${said}`);
  }
  return ran.stdout;
}

type TreeEntry = { mode: string; type: string; object: string; path: string };

/** The entries of `tree` under `folder`, recursively, as `git ls-tree -r -z` lists them. */
function entriesUnder(repository: string, tree: string, folder: string): TreeEntry[] {
  return git(repository, ['ls-tree', '-r', '-z', '--full-tree', tree, '--', `${folder}/`])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      // A path may hold a tab or a line break: only the first tab ends the metadata.
      const tab = line.indexOf('\t');
      const [mode = '', type = '', object = ''] = line.slice(0, tab).split(' ');
      return { mode, type, object, path: line.slice(tab + 1) };
    });
}

export type MirrorCommit = { commit: string; tree: string; sourceTree: string };

/**
 * Builds the mirror commit of `commit`: its tree with every file under .github/workflows moved to
 * .github/held-workflows and `workflow` placed as the one workflow, as one parentless commit by
 * `identity` with `message`. Refuses a source that already holds .github/held-workflows, and an
 * identity that is the source commit's author or committer.
 */
export function buildMirrorCommit(input: {
  repository: string;
  commit: string;
  workflow: string;
  identity: MirrorIdentity;
  message: string;
  date: Date;
}): MirrorCommit {
  const { repository, commit, identity } = input;
  const sourceTree = git(repository, ['rev-parse', '--verify', `${commit}^{tree}`]).trim();
  const people = git(repository, ['log', '-1', '--format=%ae%n%ce', commit]).trim().split('\n');
  if (people.includes(identity.email))
    throw new Error(`The mirror identity is the source commit's own (${identity.email}).`);
  if (entriesUnder(repository, sourceTree, HELD_WORKFLOWS).length)
    throw new Error(`The source tree holds ${HELD_WORKFLOWS}, where the mirror keeps its workflows.`);
  const folder = mkdtempSync(join(tmpdir(), 'ci-mirror-index-'));
  try {
    const env = { GIT_INDEX_FILE: join(folder, 'index') };
    git(repository, ['read-tree', sourceTree], { env });
    const workflows = entriesUnder(repository, sourceTree, SOURCE_WORKFLOWS);
    const placed = git(repository, ['hash-object', '-w', '--stdin'], { input: input.workflow }).trim();
    // NUL-terminated records keep every path byte, a tab or a line break included.
    const updates = [
      ...workflows.map((entry) => `0 ${'0'.repeat(40)}\t${entry.path}`),
      ...workflows.map(
        (entry) =>
          `${entry.mode} ${entry.object}\t${HELD_WORKFLOWS}${entry.path.slice(SOURCE_WORKFLOWS.length)}`,
      ),
      `100644 ${placed}\t${MIRROR_WORKFLOW}`,
    ];
    git(repository, ['update-index', '-z', '--index-info'], { env, input: `${updates.join('\0')}\0` });
    const tree = git(repository, ['write-tree'], { env }).trim();
    // The tree holds the mirror's workflow and nothing else under .github/workflows.
    const active = entriesUnder(repository, tree, SOURCE_WORKFLOWS);
    if (active.length !== 1 || active[0]?.path !== MIRROR_WORKFLOW || active[0].object !== placed)
      throw new Error(`The mirror tree holds ${active.length} workflows, not the mirror's alone.`);
    const date = input.date.toISOString();
    const mirror = git(repository, ['commit-tree', '--no-gpg-sign', tree, '-F', '-'], {
      input: input.message,
      env: {
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
        GIT_COMMITTER_DATE: date,
      },
    }).trim();
    return { commit: mirror, tree, sourceTree };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Pushes `commit` to `branch` of `remote`, replacing the branch when it exists: the mirror cancels
 * the run it replaces (its workflow's concurrency group). The token reaches git through its
 * environment only, never an argument or a configuration file, and no hook or credential helper of
 * the orchestrator's clone runs.
 */
export function pushMirrorCommit(input: {
  repository: string;
  remote: string;
  commit: string;
  branch: string;
  token: string | undefined;
}): void {
  // The header goes to the remote's own origin only, never to a host it redirects to.
  const header =
    input.token && /^https:\/\//.test(input.remote)
      ? {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: `http.${new URL(input.remote).origin}/.extraheader`,
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${input.token}`).toString('base64')}`,
        }
      : {};
  if (input.token && !Object.keys(header).length) throw new Error('A token goes to an https remote only.');
  git(
    input.repository,
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'credential.helper=',
      'push',
      '--quiet',
      '--no-verify',
      input.remote,
      `+${input.commit}:refs/heads/${input.branch}`,
    ],
    { env: header, quiet: true },
  );
}
