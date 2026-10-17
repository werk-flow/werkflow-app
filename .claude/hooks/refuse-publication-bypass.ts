import { publicationBypass } from '../../lib/testing/publication/push-bypass';

/**
 * Prepared PreToolUse hook for Bash and PowerShell calls (audit finding B6, 2026-10-16): exits 2
 * with the reason when the command would push past the publication gate or switch it off
 * (lib/testing/publication/push-bypass.ts). Wiring it into .claude/settings.json is the owner's
 * act; until then nothing runs it. A call it cannot read passes, as in the edit guard.
 */
let command: unknown;
try {
  const call: unknown = JSON.parse(await Bun.stdin.text());
  const input = call && typeof call === 'object' ? Reflect.get(call, 'tool_input') : undefined;
  command = input && typeof input === 'object' ? Reflect.get(input, 'command') : undefined;
} catch {
  // An unreadable call is no shell command this hook can judge.
  process.exit(0);
}
const reason = typeof command === 'string' ? publicationBypass(command) : undefined;
if (reason) {
  console.error(
    `Refused: ${reason}. A push goes through .githooks/pre-push (docs/technical/testing.md, "Publication gate"); only the owner overrides it, with WERKFLOW_PUSH_OVERRIDE="<reason>", which the hook logs.`,
  );
  process.exit(2);
}
process.exit(0);
