import { accountSignInRefusal } from '../../lib/security/account-sign-in';
import { shellCommand } from '../../lib/testing/runner/edit-guard';

/**
 * PreToolUse hook for shell calls, wired in .claude/settings.json and
 * .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts): exits 2
 * with the reason when the command starts a sign-in, hands out an account token
 * or runs the Vercel CLI (lib/security/account-sign-in.ts). A call it cannot
 * read is refused.
 */
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  console.error('Refused: the sign-in guard could not read the shell call, so it cannot rule out a sign-in.');
  process.exit(2);
}
if (!call || typeof call !== 'object') {
  console.error('Refused: the sign-in guard could not read the shell call, so it cannot rule out a sign-in.');
  process.exit(2);
}
const command = shellCommand({ tool_name: Reflect.get(call, 'tool_name'), tool_input: Reflect.get(call, 'tool_input') });
const reason = command ? accountSignInRefusal(command) : undefined;
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
