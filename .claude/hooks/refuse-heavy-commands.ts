import { resolve } from 'node:path';
import { heavyCommandRefusal } from '../../lib/testing/runner/heavy-command';
import { shellCommand } from '../../lib/testing/runner/edit-guard';
import { currentAgentTool, stampHookRun } from '../../lib/testing/runner/hook-stamp';

/**
 * PreToolUse hook for shell calls, wired in .claude/settings.json and
 * .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts): exits 2
 * with the reason and the sanctioned command when the call runs a
 * whole-repository tsc, a broad type-aware eslint or `next build` outside a
 * heavy slot (lib/testing/runner/heavy-command.ts).
 *
 * Threat model: the hook stops habit, not deliberate evasion. A call it cannot
 * read passes, as in the delete guard: it guards the machine's load, not a secret.
 */
stampHookRun(import.meta.path, resolve(import.meta.dir, '../..'), currentAgentTool());
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}
if (!call || typeof call !== 'object') process.exit(0);
const command = shellCommand({ tool_name: Reflect.get(call, 'tool_name'), tool_input: Reflect.get(call, 'tool_input') });
const cwd: unknown = Reflect.get(call, 'cwd');
const reason = command
  ? heavyCommandRefusal(command, typeof cwd === 'string' && cwd ? cwd : process.cwd())
  : undefined;
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
