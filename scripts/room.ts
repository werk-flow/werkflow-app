import {
  isStartKind,
  measuredAdmission,
  START_COST,
  type StartKind,
  waitForAdmission,
} from '../lib/testing/runner/machine-room';

// `bun run room`: prints whether this machine now admits a heavy command, a
// worktree setup, a child thread and a device boot, with the numbers
// (lib/testing/runner/machine-room.ts).
// `bun run room --wait thread|setup|heavy|device`: returns once that start is
// admitted; a thread waits for memory and load both. The child-start hook names it. On a machine without the load watch
// a thread is never admitted, so the wait exits 1 with the install command.
const POLL_MILLISECONDS = 15_000;

const waitAt = process.argv.indexOf('--wait');
const waited = waitAt === -1 ? undefined : process.argv[waitAt + 1];
if (waitAt === -1) {
  for (const start of ['heavy', 'setup', 'thread', 'device'] satisfies StartKind[]) {
    const verdict = measuredAdmission(start);
    console.log(`${start.padEnd(6)} ${verdict.admitted ? 'admitted' : 'refused '}  ${verdict.reason}`);
  }
  process.exit(0);
}
if (!isStartKind(waited)) {
  console.error(`Usage: bun run room [--wait ${Object.keys(START_COST).join('|')}]`);
  process.exit(2);
}
const verdict = await waitForAdmission(
  () => measuredAdmission(waited),
  (refused) => console.log(`[room] ${waited} waits: ${refused.reason}`),
  () => new Promise((resume) => setTimeout(resume, POLL_MILLISECONDS)),
);
if (!verdict.admitted) {
  console.error(`[room] ${waited} is refused and waiting cannot change it: ${verdict.reason}`);
  process.exit(1);
}
console.log(`[room] ${waited} admitted: ${verdict.reason}`);
