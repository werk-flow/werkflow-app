import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { withFileLock, writeJsonAtomically } from './file-lock';

const counterSchema = z.object({ count: z.number() });

const [path, rawIterations] = process.argv.slice(2);
const iterations = Number(rawIterations);
if (!path || !Number.isInteger(iterations) || iterations < 1) {
  throw new Error('Usage: bun file-lock-worker.ts <path> <positive-iterations>');
}

for (let iteration = 0; iteration < iterations; iteration += 1) {
  withFileLock(`${path}.lock`, () => {
    const current = counterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    writeJsonAtomically(path, { count: current.count + 1 });
  });
}
