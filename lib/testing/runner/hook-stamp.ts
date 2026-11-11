import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// The guards of .claude/settings.json and .codex/hooks.json only hold while the
// agent tool runs them. Codex skips a project hook until the owner has trusted
// it with `/hooks`, on each machine and again after every change to the entry,
// and says nothing when it skips. So each hook that runs before a shell call
// leaves a stamp in its checkout, and `bun run check:changed` fails under an
// agent tool whose stamps are missing: an untrusted hook file cannot produce a
// green local check (werk-flow/werkflow-planning#294).
//
// A stamp names the tool, the hook script and a hash of the entry's command
// and the script's text, so a changed entry or script needs a new run.
//
// Only Node built-ins: the hooks run before a worktree's install.

export type AgentTool = 'claude' | 'codex';
const HOOK_FILES: Readonly<Record<AgentTool, string>> = {
  claude: '.claude/settings.json',
  codex: '.codex/hooks.json',
};
const SCRIPT = /((?:\.claude\/hooks|scripts)\/[\w-]+\.ts)/;
type ProcessRow = { readonly pid: number; readonly parent: number; readonly program: string };

/** Every process as pid, parent and program name, from one `ps` call. */
function programTable(): ProcessRow[] {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' }).stdout;
  return listed.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), parent: Number(match[2]), program: basename(match[3] ?? '') }]
      : [];
  });
}

/** The agent tool a process runs under: its nearest ancestor named `claude` or `codex`, or undefined in a human shell. */
export function agentToolOf(pid: number, processes: readonly ProcessRow[]): AgentTool | undefined {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  for (let row = byPid.get(pid); row && !seen.has(row.pid); row = byPid.get(row.parent)) {
    seen.add(row.pid);
    if (row.program === 'claude' || row.program === 'codex') return row.program;
  }
  return undefined;
}

/** The agent tool this process runs under, or undefined. */
export const currentAgentTool = (): AgentTool | undefined => agentToolOf(process.pid, programTable());

/** The hook scripts a tool's hook file runs before every shell call, each with the name of its stamp. */
export function shellHookStamps(
  tool: AgentTool,
  repositoryRoot: string,
): { script: string; stamp: string }[] {
  const file: unknown = JSON.parse(readFileSync(resolve(repositoryRoot, HOOK_FILES[tool]), 'utf8'));
  const entries: unknown = Reflect.get(Object(Reflect.get(Object(file), 'hooks')), 'PreToolUse');
  if (!Array.isArray(entries)) return [];
  const stamps: { script: string; stamp: string }[] = [];
  for (const entry of entries) {
    const matcher: unknown = Reflect.get(Object(entry), 'matcher');
    const hooks: unknown = Reflect.get(Object(entry), 'hooks');
    if (typeof matcher !== 'string' || !new RegExp(`^(?:${matcher})$`).test('Bash') || !Array.isArray(hooks))
      continue;
    for (const hook of hooks) {
      const command: unknown = Reflect.get(Object(hook), 'command');
      const script = typeof command === 'string' ? SCRIPT.exec(command)?.[1] : undefined;
      if (typeof command !== 'string' || !script) continue;
      const text = readFileSync(resolve(repositoryRoot, script), 'utf8');
      const hash = createHash('sha256').update(command).update('\0').update(text).digest('hex').slice(0, 16);
      stamps.push({ script, stamp: `${tool}-${basename(script, '.ts')}-${hash}` });
    }
  }
  return stamps;
}

const stampDirectory = (repositoryRoot: string): string => join(repositoryRoot, '.t3', 'hook-stamps');

/**
 * Called first by every hook that runs before a shell call: records that
 * `tool` ran `script` in this checkout. A hook started by neither tool, or one
 * its tool's hook file does not run before a shell call, leaves no stamp. It
 * never throws: a guard decides its call whatever happens to the stamp.
 */
export function stampHookRun(scriptPath: string, repositoryRoot: string, tool: AgentTool | undefined): void {
  if (!tool) return;
  try {
    const stamp = shellHookStamps(tool, repositoryRoot).find(
      (entry) => resolve(repositoryRoot, entry.script) === resolve(scriptPath),
    )?.stamp;
    if (!stamp || existsSync(join(stampDirectory(repositoryRoot), stamp))) return;
    mkdirSync(stampDirectory(repositoryRoot), { recursive: true });
    writeFileSync(join(stampDirectory(repositoryRoot), stamp), '');
  } catch {
    // A stamp that cannot be written never stops a guard: check:changed reports the missing stamp.
  }
}

/**
 * Why `check:changed` must not pass in this checkout: the agent tool it runs
 * under has not run every hook of its hook file before a shell call. Undefined
 * in a human shell and in CI, where no agent tool is an ancestor.
 */
export function untrustedHooksRefusal(
  repositoryRoot: string,
  tool: AgentTool | undefined,
): string | undefined {
  if (!tool) return undefined;
  const missing = shellHookStamps(tool, repositoryRoot)
    .filter((entry) => !existsSync(join(stampDirectory(repositoryRoot), entry.stamp)))
    .map((entry) => entry.script);
  if (missing.length === 0) return undefined;
  const trust =
    tool === 'codex'
      ? 'Codex runs a project hook only after the owner has trusted it: ask the owner to run `/hooks` in Codex on this machine and trust the hooks of `.codex/hooks.json`, then run any shell command and this check again.'
      : 'Claude Code runs the hooks of `.claude/settings.json` once the workspace is trusted and the session has loaded them: start a new session in this checkout, run any shell command and this check again.';
  return [
    `check:changed refuses to pass: ${tool} has not run ${missing.length === 1 ? 'this guard' : 'these guards'} before a shell call in this checkout: ${missing.join(', ')}.`,
    'Without them nothing here refuses a read of production, a heavy command outside a slot or a second stack.',
    trust,
  ].join(' ');
}
