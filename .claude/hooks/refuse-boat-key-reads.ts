import { homedir } from 'node:os';

import { boatKeyCommandRefusal, boatKeyToolRefusal, shellFolder } from '../../lib/security/boat-key-access';
import { shellCommand } from '../../lib/testing/runner/edit-guard';

/**
 * PreToolUse hook for shell, Read and Grep calls, wired in .claude/settings.json
 * and .codex/hooks.json (pinned by lib/testing/runner/guard-wiring.test.ts):
 * exits 2 with the reason when the call would read a Boat API key
 * (lib/security/boat-key-access.ts). A call it cannot read is refused.
 */
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  console.error('Refused: the Boat key guard could not read the call, so it cannot rule out a read of the key.');
  process.exit(2);
}
if (!call || typeof call !== 'object') {
  console.error('Refused: the Boat key guard could not read the call, so it cannot rule out a read of the key.');
  process.exit(2);
}
const toolName: unknown = Reflect.get(call, 'tool_name');
const toolInput: unknown = Reflect.get(call, 'tool_input');
const toolCall = { tool_name: toolName, tool_input: toolInput };
const cwd: unknown = Reflect.get(call, 'cwd');
const context = { cwd: typeof cwd === 'string' && cwd ? cwd : process.cwd(), home: homedir() };
const command = shellCommand(toolCall);
const reason = command
  ? boatKeyCommandRefusal(command, { ...context, cwd: shellFolder(toolInput, context) })
  : boatKeyToolRefusal(toolCall, context);
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
