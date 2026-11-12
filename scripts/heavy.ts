import { runInHeavySlot } from '../lib/testing/runner/heavy-slot';

// `bun scripts/heavy.ts -- <command...>`: runs one command inside a machine-wide
// heavy slot (lib/testing/runner/heavy-slot.ts), for deliberate heavy work no
// package script covers, such as `tsc --explainFiles`. The heavy command guard
// (lib/testing/runner/heavy-command.ts) names it. It waits for a free slot,
// holds it until the command exits, and exits with the command's code.
const separator = process.argv.indexOf('--');
const command = separator === -1 ? process.argv.slice(2) : process.argv.slice(separator + 1);
if (command.length === 0) {
  console.error('Usage: bun scripts/heavy.ts -- <command> [arguments...]');
  process.exit(2);
}
process.exit(await runInHeavySlot(command));
