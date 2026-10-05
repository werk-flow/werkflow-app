import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  editedFiles,
  guardedInputs,
  refusalMessage,
  sourceRewritingCommand,
  type GuardedToolCall,
} from '../lib/testing/runner/edit-guard';

/**
 * Pre-edit hook of the agent tools (.claude/settings.json, .codex/hooks.json).
 * It reads the pending tool call on stdin and exits 2 with a reason when the
 * call would change a proof input while a test operation holds the workspace
 * lock (docs/technical/testing.md, "How a run executes"). Every other case
 * exits 0, including a guard that cannot decide: the runner's own drift check
 * still voids a run whose inputs changed.
 */
const repositoryRoot = resolve(import.meta.dir, '..');
const lockPath = resolve(repositoryRoot, '.agent-logs/workspace-test-operation.lock');

function liveLockOwner(): { operation: string; startedAt: string } | undefined {
  if (!existsSync(lockPath)) return undefined;
  try {
    const owner: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!owner || typeof owner !== 'object') return undefined;
    const { processId, operation, startedAt } = owner as Record<string, unknown>;
    if (typeof processId !== 'number' || typeof operation !== 'string' || typeof startedAt !== 'string')
      return undefined;
    // Signal 0 only asks whether the process exists; a crashed run's lock must not block edits.
    process.kill(processId, 0);
    return { operation, startedAt };
  } catch {
    return undefined;
  }
}

function ignoredByGit(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: repositoryRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const owner = liveLockOwner();
if (!owner) process.exit(0);

let call: GuardedToolCall & { cwd?: unknown };
try {
  call = JSON.parse(await Bun.stdin.text()) as GuardedToolCall & { cwd?: unknown };
} catch {
  process.exit(0);
}

const command = sourceRewritingCommand(call);
if (command) {
  console.error(refusalMessage({ ...owner, inputs: [], command }));
  process.exit(2);
}

const files = editedFiles(call);
if (!files.length) process.exit(0);
// Loaded only now: the common case of no running operation must stay fast.
const { isDocumentationInput } = await import('../lib/testing/evidence/group-evidence');
const inputs = guardedInputs({
  files,
  repositoryRoot,
  cwd: typeof call.cwd === 'string' ? call.cwd : repositoryRoot,
  outsideProof: (path) => path.startsWith('.agent-logs/') || isDocumentationInput(path) || ignoredByGit(path),
});
if (!inputs.length) process.exit(0);
console.error(refusalMessage({ ...owner, inputs }));
process.exit(2);
