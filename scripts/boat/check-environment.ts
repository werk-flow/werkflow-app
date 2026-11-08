// Runs on a Boat machine for scripts/boat/remote-verify.sh: exits 0 when every backend value in this
// checkout's `.env.local` equals the workstation's, by digest, and names the keys that differ
// otherwise. Only then may the machine record the workstation's environment digest on its proofs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { backendValueDigests } from '../../lib/testing/evidence/proof-environment';
import { z } from '../../lib/zod';

const expected = z
  .record(z.string(), z.string())
  .parse(JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')));
const actual = backendValueDigests(resolve(import.meta.dir, '../..'));
const differing = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
  .filter((key) => expected[key] !== actual[key])
  .sort();
if (differing.length) {
  console.error(`[boat] the machine's stack differs from the workstation's in ${differing.join(', ')}`);
  process.exit(1);
}
