import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { errorCode } from './error-code';
import { writeJsonAtomically } from './file-lock';

/**
 * Every worktree of this repository runs its browser groups against the one
 * local Supabase stack. Ordinary groups share it, because each owns its own
 * organization. A group that measures (freshness, readiness, scenarios, lab
 * counts) or restarts a stack service holds it alone: another worktree's
 * traffic would enter its gateway counts and timings, and a Realtime restart
 * would drop the other worktree's subscriptions. The holders live in the git
 * common directory, which every worktree of the clone shares.
 */
export type StackLockMode = 'shared' | 'exclusive';

const holderSchema = z.object({
  token: z.string().min(1),
  processId: z.number().int().positive(),
  mode: z.enum(['shared', 'exclusive']),
  operation: z.string(),
  workspace: z.string(),
  startedAt: z.string(),
});
type StackLockHolder = z.infer<typeof holderSchema>;

const TOKEN_ENV = 'WERKFLOW_STACK_LOCK_TOKEN';
const MODE_ENV = 'WERKFLOW_STACK_LOCK_MODE';
const POLL_MS = 1_000;

export function stackLockDirectory(repositoryRoot: string): string {
  const commonDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  return resolve(commonDirectory, 'werkflow-local-stack');
}

function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists under another user.
    return errorCode(error) === 'EPERM';
  }
}

/** The live holders; a holder whose process is gone left after a kill and is removed. */
export function readStackLockHolders(directory: string): StackLockHolder[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const holders: StackLockHolder[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const path = resolve(directory, name);
    let holder: StackLockHolder;
    try {
      holder = holderSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      // A holder appears by rename, whole; one that is gone left between the listing and the read.
      if (errorCode(error) === 'ENOENT') continue;
      throw new Error(`Unreadable local stack holder ${path}; inspect and remove it if its run is gone.`, {
        cause: error,
      });
    }
    if (isRunning(holder.processId)) holders.push(holder);
    else rmSync(path, { force: true });
  }
  return holders;
}

/**
 * The holders `own` must wait for. A shared holder waits for every exclusive
 * one, held or waiting; an exclusive holder waits for every shared one and for
 * the exclusive ones that registered before it.
 */
export function stackLockConflicts(
  own: Pick<StackLockHolder, 'token' | 'mode' | 'startedAt'>,
  holders: readonly StackLockHolder[],
): StackLockHolder[] {
  const earlier = (holder: StackLockHolder): boolean =>
    holder.startedAt < own.startedAt || (holder.startedAt === own.startedAt && holder.token < own.token);
  return holders.filter((holder) => {
    if (holder.token === own.token) return false;
    if (own.mode === 'shared') return holder.mode === 'exclusive';
    return holder.mode === 'shared' || earlier(holder);
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The stack lock wait was cancelled.');
}

async function pause(signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolveDelay, reject) => {
    const timer = setTimeout(done, POLL_MS);
    function done(): void {
      signal?.removeEventListener('abort', onAbort);
      resolveDelay();
    }
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortReason(signal ?? new AbortController().signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `operation` while this process holds the local stack in `mode`. A
 * child process inherits the hold through the environment `operation`
 * receives. A waiting exclusive holder registers first, so new shared holders
 * queue behind it.
 */
export async function withStackLock<T>(
  input: { mode: StackLockMode; operation: string; repositoryRoot: string; signal?: AbortSignal },
  operation: (holdEnvironment: Readonly<Record<string, string>>) => Promise<T>,
): Promise<T> {
  const inheritedToken = process.env[TOKEN_ENV];
  const inheritedMode = process.env[MODE_ENV];
  if (inheritedToken && (inheritedMode === 'exclusive' || inheritedMode === input.mode))
    return operation({ [TOKEN_ENV]: inheritedToken, [MODE_ENV]: inheritedMode });
  if (inheritedToken)
    throw new Error('A shared stack hold cannot become exclusive; take the exclusive hold first.');
  const directory = stackLockDirectory(input.repositoryRoot);
  mkdirSync(directory, { recursive: true });
  const holder: StackLockHolder = {
    token: randomUUID(),
    processId: process.pid,
    mode: input.mode,
    operation: input.operation,
    workspace: input.repositoryRoot,
    startedAt: new Date().toISOString(),
  };
  const path = resolve(directory, `${holder.mode}-${holder.token}.json`);
  // Written to a temporary name and renamed, so a reader never meets a half-written holder.
  const register = (): void => writeJsonAtomically(path, holder);
  let reported = '';
  try {
    if (holder.mode === 'exclusive') register();
    for (;;) {
      if (holder.mode === 'shared') register();
      const conflicts = stackLockConflicts(holder, readStackLockHolders(directory));
      if (!conflicts.length) break;
      // A shared holder steps back while an exclusive one holds or waits.
      if (holder.mode === 'shared') rmSync(path, { force: true });
      const waitingFor = conflicts
        .map((conflict) => `${conflict.operation} (${conflict.mode}, ${conflict.workspace})`)
        .join('; ');
      if (waitingFor !== reported)
        console.info(`[werkflow-test] Waiting for the local stack: ${waitingFor}.`);
      reported = waitingFor;
      await pause(input.signal);
    }
    return await operation({ [TOKEN_ENV]: holder.token, [MODE_ENV]: holder.mode });
  } finally {
    rmSync(path, { force: true });
  }
}
