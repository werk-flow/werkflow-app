import { patternKillRefusal } from '../../lib/testing/runner/pattern-kill';
import { shellCommand } from '../../lib/testing/runner/edit-guard';

/** PreToolUse Bash hook: refuse shared-machine process discovery kills with exit 2. */
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
const reason = command ? patternKillRefusal(command) : undefined;
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
