// Runs on a Boat machine for scripts/boat/remote-verify.sh: exits 0 when git reads the rebuilt
// checkout as changed since HEAD in exactly the paths it reads on the workstation, and names the
// paths that differ otherwise. A plan without a baseline report selects from those paths, so only
// then does the machine select the groups a local run would.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { changedSinceHead, rebuiltTreeProblem } from '../../lib/testing/boat/verify-on-boat';
import { z } from '../../lib/zod';

const workstation = z.array(z.string()).parse(JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')));
const problem = rebuiltTreeProblem(workstation, changedSinceHead(resolve(import.meta.dir, '../..')));
if (problem) {
  console.error(`[boat] ${problem}`);
  process.exit(1);
}
