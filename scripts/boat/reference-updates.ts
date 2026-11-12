// Runs on a Boat machine for scripts/boat/remote-verify.sh around a visual reference update
// (lib/testing/boat/reference-updates.ts):
//   record <hashes file>           before the update: the hash of every audit reference.
//   collect <hashes file> <folder> after it: copies each reference it rewrote or wrote into <folder>.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from '../../lib/zod';

import { collectReferenceUpdates, referenceHashes } from '../../lib/testing/boat/reference-updates';

const repository = resolve(import.meta.dir, '../..');
const [mode, hashes = '', folder = ''] = process.argv.slice(2);
if (mode === 'record') {
  writeFileSync(hashes, JSON.stringify(Object.fromEntries(referenceHashes(repository))));
} else if (mode === 'collect') {
  const before = new Map(
    Object.entries(z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(hashes, 'utf8')))),
  );
  const changed = collectReferenceUpdates(repository, before, resolve(repository, folder));
  console.log(
    `[boat] the update rewrote or wrote ${changed.length} visual references; they come back with the evidence.`,
  );
} else {
  throw new Error('Usage: reference-updates.ts record <hashes file> | collect <hashes file> <folder>');
}
