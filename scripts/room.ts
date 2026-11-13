import {
  isStartKind,
  measuredAdmission,
  START_COST,
  type StartKind,
} from '../lib/testing/runner/machine-room';

// `bun run room`: prints whether this machine now admits a heavy command, a
// worktree setup, a child thread and a device boot, with the numbers
// (lib/testing/runner/machine-room.ts).
// `bun run room --wait thread|setup|heavy|device`: returns once that start is
// admitted. The child-start hook names it. On a machine without the load watch
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
let announced = false;
for (;;) {
  const verdict = measuredAdmission(waited);
  if (verdict.admitted) {
    console.log(`[room] ${waited} admitted: ${verdict.reason}`);
    process.exit(0);
  }
  if (verdict.unwatched) {
    console.error(`[room] ${waited} is refused and waiting cannot change it: ${verdict.reason}`);
    process.exit(1);
  }
  if (!announced) {
    announced = true;
    console.log(`[room] ${waited} waits: ${verdict.reason}`);
  }
  await new Promise((resume) => setTimeout(resume, POLL_MILLISECONDS));
}
