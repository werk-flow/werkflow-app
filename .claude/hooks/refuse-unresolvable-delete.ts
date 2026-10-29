import { unresolvableDeleteRefusal } from '../../lib/testing/runner/unresolvable-delete';
import { shellCommand } from '../../lib/testing/runner/edit-guard';

/**
 * PreToolUse hook for Bash calls, wired in .claude/settings.json (pinned by
 * lib/testing/runner/guard-wiring.test.ts): exits 2 with the reason when the
 * command runs `rm` on a variable or on a wildcard with a relative path
 * (lib/testing/runner/unresolvable-delete.ts). A call it cannot read passes, as
 * in the edit guard.
 */
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  // An unreadable call is no shell command this hook can judge.
  process.exit(0);
}
const command =
  call && typeof call === 'object'
    ? shellCommand({ tool_name: Reflect.get(call, 'tool_name'), tool_input: Reflect.get(call, 'tool_input') })
    : undefined;
const reason = command ? unresolvableDeleteRefusal(command) : undefined;
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
