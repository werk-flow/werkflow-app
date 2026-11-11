import { sharedStackMigrationRefusal } from '../../lib/testing/local-stack/shared-stack-migration';
import { shellCommand } from '../../lib/testing/runner/edit-guard';

/**
 * PreToolUse hook for shell calls, wired in .claude/settings.json and
 * .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts): exits 2
 * with the reason and the sanctioned command when the call would apply this
 * tree's migrations to the local stack every worktree shares
 * (lib/testing/local-stack/shared-stack-migration.ts).
 *
 * Threat model: the hook stops habit, not deliberate evasion. A call it cannot
 * read passes, as in the delete guard: it guards a test database, not a secret,
 * and the stack's ledger trigger refuses the same write from any shell.
 */
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}
if (!call || typeof call !== 'object') process.exit(0);
const command = shellCommand({
  tool_name: Reflect.get(call, 'tool_name'),
  tool_input: Reflect.get(call, 'tool_input'),
});
const reason = command ? sharedStackMigrationRefusal(command) : undefined;
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
