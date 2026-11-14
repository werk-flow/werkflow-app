import { childStartRefusal, thisEnvironmentId } from '../../lib/testing/runner/child-start';
import { measuredAdmission } from '../../lib/testing/runner/machine-room';

/**
 * PreToolUse hook for T3 Code's thread-start tools, wired in
 * .claude/settings.json and .codex/hooks.json (pinned by
 * lib/testing/runner/guard-wiring.test.ts): exits 2 with the numbers and the
 * ways on when the call starts a thread on this machine without room for it
 * (lib/testing/runner/child-start.ts). A call it cannot read is refused, and
 * so is every local start on a machine it cannot measure. Without this
 * machine's own environment id, every start counts as local.
 */
let call: unknown;
try {
  call = JSON.parse(await Bun.stdin.text());
} catch {
  call = undefined;
}
const reason = childStartRefusal(
  call,
  (threads) => measuredAdmission('thread', process.env, threads),
  thisEnvironmentId(process.env),
);
if (reason) {
  console.error(reason);
  process.exit(2);
}
process.exit(0);
