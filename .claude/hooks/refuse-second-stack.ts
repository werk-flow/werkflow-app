import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { secondStackRefusal, stackProjectId } from '../../lib/testing/runner/second-stack';
import { shellCommand } from '../../lib/testing/runner/edit-guard';
import { currentAgentTool, stampHookRun } from '../../lib/testing/runner/hook-stamp';

/**
 * PreToolUse hook for shell calls, wired in .claude/settings.json and
 * .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts): exits 2
 * with the reason when the call starts a local Supabase stack other than the
 * main checkout's (lib/testing/runner/second-stack.ts).
 *
 * Threat model: the hook stops habit, not deliberate evasion. A call it cannot
 * read passes, as in the heavy command guard: it guards the machine's memory,
 * not a secret.
 */
stampHookRun(import.meta.path, resolve(import.meta.dir, '../..'), currentAgentTool());
const repositoryRoot = resolve(import.meta.dir, '../..');

/** The main checkout, whose stack every worktree shares; this checkout when git does not answer. */
function mainCheckout(): string {
  try {
    const gitDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return dirname(gitDirectory);
  } catch {
    return repositoryRoot;
  }
}

let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}
if (!call || typeof call !== 'object') process.exit(0);
const command = shellCommand({ tool_name: Reflect.get(call, 'tool_name'), tool_input: Reflect.get(call, 'tool_input') });
const cwd: unknown = Reflect.get(call, 'cwd');
const shared = stackProjectId(mainCheckout()) ?? stackProjectId(repositoryRoot);
const reason =
  command && shared
    ? secondStackRefusal(command, typeof cwd === 'string' && cwd ? cwd : process.cwd(), shared)
    : undefined;
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
