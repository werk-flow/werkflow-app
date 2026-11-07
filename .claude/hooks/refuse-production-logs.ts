import { productionLogCommandRefusal } from '../../lib/security/production-access';
import { shellCommand } from '../../lib/testing/runner/edit-guard';

/**
 * PreToolUse hook for shell calls, wired in .claude/settings.json and
 * .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts): exits 2
 * with the reason when the command reads Vercel's production logs
 * (lib/security/production-access.ts). A call it cannot read is refused.
 *
 * Threat model: the hook stops accidental and habitual reads. Deliberate
 * evasion is a rule violation it does not claim to catch.
 */
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  console.error('Refused: the log guard could not read the shell call, so it cannot rule out PROD logs.');
  process.exit(2);
}
const command =
  call && typeof call === 'object'
    ? shellCommand({ tool_name: Reflect.get(call, 'tool_name'), tool_input: Reflect.get(call, 'tool_input') })
    : undefined;
const reason = command ? productionLogCommandRefusal(command) : undefined;
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
