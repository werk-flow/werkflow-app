// Usage: bun scripts/boat/reap-idle-machine.ts <idle record>
// Started detached by lib/testing/boat/machine-reuse.ts after a run keeps its wiped machine: deletes
// that machine once it has waited IDLE_SECONDS for the checkout's next run, unless that run took it.

import { reapIdleMachine } from '../../lib/testing/boat/machine-reuse';

const record = process.argv[2];
if (record) await reapIdleMachine(record);
