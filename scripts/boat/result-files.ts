// Runs on a Boat machine for scripts/boat/remote-verify.sh: reads the run's new evidence folders, one
// per line, from the file named first, and writes the files that come back to the file named second,
// each ended by a NUL byte for `tar --null --files-from` (lib/testing/boat/result-files.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resultFiles } from '../../lib/testing/boat/result-files';

const [folders = '', list = ''] = process.argv.slice(2);
const selection = resultFiles(
  resolve(import.meta.dir, '../..'),
  readFileSync(folders, 'utf8').split('\n').filter(Boolean),
);
writeFileSync(list, selection.files.map((file) => `${file}\0`).join(''));
console.log(
  `[boat] ${selection.files.length} result files come back; ${(selection.leftOutBytes / 1e6).toFixed(1)} MB stay on the machine, which no workstation command reads: every browser run's HTML report and active world copy, and the traces and screenshots of ${selection.passedRuns} passed runs.`,
);
