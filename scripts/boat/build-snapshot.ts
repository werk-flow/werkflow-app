// Builds the saved Boat snapshot that every verification machine starts from
// (docs/technical/boat-verification.md): `bun run boat:snapshot`. It starts a machine from Boat's
// base image, prepares it with scripts/boat/prepare-snapshot.sh at the commit `origin/main` names,
// saves it under SNAPSHOT_NAME, and deletes the machine. A failed save keeps the previous snapshot.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { boatClient } from '../../lib/testing/boat/boat-api';
import { readBoatKey } from '../../lib/testing/boat/boat-key';
import { createMachine, deleteMachine, machineUsage, runScript } from '../../lib/testing/boat/boat-machine';
import { SNAPSHOT_NAME } from '../../lib/testing/boat/verify-on-boat';

const repository = resolve(import.meta.dir, '../..');
const log = (line: string) => console.log(`[boat:snapshot] ${line}`);

const reading = readBoatKey();
if (reading.kind !== 'usable')
  throw new Error(reading.kind === 'absent' ? 'No Boat key on this workstation.' : reading.reason);
const client = boatClient(reading.key);
const seedCommit = execFileSync('git', ['rev-parse', 'origin/main'], {
  cwd: repository,
  encoding: 'utf8',
}).trim();
const bunVersion = '1.4.4';
const started = Date.now();
const machine = await createMachine(client, {
  from: undefined,
  name: `${SNAPSHOT_NAME}-build`,
  ttlSeconds: 7_200,
  snapshots: true,
  log,
});
log(
  `machine ${machine.id} ready in ${((Date.now() - started) / 1000).toFixed(1)} s; preparing at ${seedCommit}`,
);
try {
  await client.upload(machine.id, '/home/user/bun-version', new TextEncoder().encode(`${bunVersion}\n`));
  await client.upload(machine.id, '/home/user/seed-commit', new TextEncoder().encode(`${seedCommit}\n`));
  await client.upload(
    machine.id,
    '/home/user/prepare-snapshot.sh',
    readFileSync(resolve(repository, 'scripts/boat/prepare-snapshot.sh')),
  );
  const prepared = Date.now();
  const result = await runScript(machine, 'bash ~/prepare-snapshot.sh', {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
  log(`prepared in ${((Date.now() - prepared) / 1000).toFixed(0)} s, exit ${result.exitCode}`);
  if (result.exitCode !== 0)
    throw new Error('Preparing the snapshot machine failed; the old snapshot stays.');
  await client.saveSnapshot(machine.id, SNAPSHOT_NAME);
  const saving = Date.now();
  for (;;) {
    const status = await client.snapshotStatus(SNAPSHOT_NAME);
    if (status === 'ready') break;
    if (status === 'failed') throw new Error('Boat failed to save the snapshot; the old one stays.');
    if (Date.now() - saving > 1_800_000) throw new Error('The snapshot did not become ready in 30 min.');
    await new Promise((done) => setTimeout(done, 5_000));
  }
  log(`saved ${SNAPSHOT_NAME} in ${((Date.now() - saving) / 1000).toFixed(0)} s`);
} finally {
  const usage = await machineUsage(machine);
  await deleteMachine(machine);
  log(
    `machine ${machine.id} deleted; ${usage ? `${usage.seconds} billable s, $${usage.dollars.toFixed(4)}` : 'cost unknown'}`,
  );
}
