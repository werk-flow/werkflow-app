import { resolve } from 'node:path';
import { formatQuarantines, listQuarantines } from '../lib/testing/quarantines';

// Prints every quarantined test as Markdown. The nightly run writes it into its
// summary, so a skipped test stays visible until its issue brings it back.
process.stdout.write(formatQuarantines(listQuarantines(resolve(import.meta.dir, '..'))));
