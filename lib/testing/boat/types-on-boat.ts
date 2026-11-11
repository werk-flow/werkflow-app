import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../../zod';

import { type MigrationDrift, driftLine } from '../local-stack/migration-drift';
import { getSpawnFailureDetail } from '../runner/spawn-result';
import { readBoatKey, withBoatKey, type BoatKeyReading } from './boat-key';
import { type BoatUnavailable } from './boat-unavailable';
import { gitEnvironment, runOnBoat, withRunFolder } from './verify-on-boat';

// `bun run types:generate -- --local` writes the types of this tree's migrations. Every worktree
// of a workstation shares one local stack, which holds main's migrations and never a branch's
// (docs/technical/environments.md, "The migration rule"), so a tree whose migrations differ from
// that stack reads a private copy of it first (lib/testing/local-stack/stack-copy.ts). Where no
// copy can answer, the types come from an isolated stack at the tree's migrations: a Boat
// machine's, or, on a workstation without Boat, the one CI's SQL job started for the pushed commit.

type Environment = Readonly<Record<string, string | undefined>>;

/** Where remote-verify.sh leaves the generated file, so it returns with the run's evidence. */
const BOAT_TYPES_FILE = '.agent-logs/types/generated/database.types.ts';
/** The artifact CI's SQL job uploads when the committed types are stale, and its one file. */
const CI_TYPES_ARTIFACT = 'database-types';
const CI_TYPES_FILE = 'database.types.ts';
const CI_WORKFLOW = 'ci.yml';
/** The files the CI artifact was generated from; it answers for the commit only while they are HEAD's. */
const CI_INPUTS = ['supabase/migrations', 'supabase/config.toml', 'lib/supabase/database.types.ts'];

/**
 * Why the stack on this machine has this tree's schema: '' on CI and on a Boat machine, whose stack
 * started at the tree's migrations, a reason to print when the shared stack's ledger matches this
 * tree's migrations by name and statements, or undefined when it differs or cannot be read.
 */
export function typesHereReason(
  env: Environment,
  readDrift: () => MigrationDrift | undefined,
): string | undefined {
  if (env.WERKFLOW_BOAT_MACHINE === '1' || env.CI === 'true') return '';
  const drift = readDrift();
  return drift && !driftLine(drift) ? "the shared stack holds exactly this tree's migrations." : undefined;
}

/**
 * The types of this tree's migrations from a Boat machine's fresh stack: the machine runs the same
 * generator on the same tree, so the file is the one CI's check computes. Answers the file's text,
 * the generator's exit code when it failed on the machine, or Boat's unavailability. `readKey` is a
 * test's stand-in.
 */
export async function typesOnBoat(
  repository: string,
  readKey: () => BoatKeyReading = readBoatKey,
): Promise<{ types: string } | { failed: number } | BoatUnavailable> {
  const outcome = await withBoatKey(undefined, readKey, (key, signal) =>
    withRunFolder(repository, signal, 'types on Boat', (folder) =>
      runOnBoat({ args: ['types:generate'], repository, folder, key, signal }),
    ),
  );
  if (typeof outcome === 'object') return outcome;
  if (outcome !== 0) return { failed: outcome ?? 1 };
  try {
    return { types: readFileSync(resolve(repository, BOAT_TYPES_FILE), 'utf8') };
  } catch {
    return { unavailable: `the Boat run returned no ${BOAT_TYPES_FILE}.` };
  }
}

const runListSchema = z.array(z.object({ databaseId: z.number(), status: z.string(), url: z.string() }));

/**
 * The types CI's SQL job generated for HEAD, which it uploads when the committed file is stale, or
 * why there are none. Only for a pushed HEAD whose migrations, stack configuration and committed
 * types are unchanged in the working tree: the artifact answers for exactly those files.
 */
export function typesFromCi(repository: string): { types: string } | { unavailable: string } {
  const run = (command: string, args: readonly string[]) =>
    spawnSync(command, args, {
      cwd: repository,
      env: gitEnvironment(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const dirty = run('git', ['status', '--porcelain', '--', ...CI_INPUTS]);
  if (!head || dirty.status !== 0) return { unavailable: 'git could not read this checkout.' };
  if (dirty.stdout.trim())
    return {
      unavailable: `commit and push the migration first: CI generates the types of a pushed commit, and ${CI_INPUTS.join(', ')} differ from HEAD here.`,
    };
  const listed = run('gh', [
    'run',
    'list',
    '--workflow',
    CI_WORKFLOW,
    '--commit',
    head,
    '--json',
    'databaseId,status,url',
    '--limit',
    '10',
  ]);
  if (listed.error || listed.status !== 0)
    return { unavailable: `gh could not list CI's runs: ${getSpawnFailureDetail(listed, 'unknown error')}` };
  const runs = runListSchema.parse(JSON.parse(listed.stdout));
  if (!runs.length)
    return {
      unavailable: `CI has no run for ${head.slice(0, 12)}: push the commit and wait for its SQL job.`,
    };
  const folder = mkdtempSync(join(tmpdir(), 'werkflow-ci-types-'));
  try {
    for (const { databaseId } of runs) {
      const target = join(folder, String(databaseId));
      const downloaded = run('gh', [
        'run',
        'download',
        String(databaseId),
        '--name',
        CI_TYPES_ARTIFACT,
        '--dir',
        target,
      ]);
      if (downloaded.status === 0) return { types: readFileSync(join(target, CI_TYPES_FILE), 'utf8') };
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  const pending = runs.find((entry) => entry.status !== 'completed');
  return {
    unavailable: pending
      ? `CI is still running for ${head.slice(0, 12)} (${pending.url}): run this again when its SQL job has finished.`
      : `no CI run of ${head.slice(0, 12)} uploaded ${CI_TYPES_ARTIFACT}: its SQL job uploads the file only when the committed types are stale, so a passed job means they are current.`,
  };
}

/**
 * The notice when neither Boat nor CI has the types: why each, that nothing was written, and the
 * way through CI for a workstation without Boat.
 */
export function typesUnavailableNotice(boat: string, ci: string): string[] {
  const rule = '='.repeat(72);
  return [
    rule,
    `BOAT IS UNAVAILABLE: ${boat}`,
    "The types are NOT generated here: the shared local stack holds main's migrations, never a",
    "branch's. No file was written; this command exits 1.",
    'Run again later to use Boat. Without Boat, CI generates them: commit and push the migration,',
    'wait until the SQL job has failed on "Check the generated types", then run this command again.',
    `CI: ${ci}`,
    rule,
  ];
}
