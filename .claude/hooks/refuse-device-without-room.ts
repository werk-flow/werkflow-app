import { deviceOpenRefusal } from '../../lib/testing/runner/device-room';

/**
 * PreToolUse hook for T3's `device_open`, wired in .claude/settings.json and
 * .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts): exits 2
 * with the reason when the call would boot a simulator or emulator on a
 * machine without room for it (lib/testing/runner/device-room.ts).
 *
 * Threat model: the hook guards the machine's load, not a secret. A call it
 * cannot read passes.
 */
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}
const input: unknown = call && typeof call === 'object' ? Reflect.get(call, 'tool_input') : undefined;
if (!input || typeof input !== 'object') process.exit(0);
const text = (key: string): string | undefined => {
  const value: unknown = Reflect.get(input, key);
  return typeof value === 'string' ? value : undefined;
};
const reason = deviceOpenRefusal({ deviceId: text('deviceId'), hostId: text('hostId'), platform: text('platform') });
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
