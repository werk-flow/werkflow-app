import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { getBusinessTodayIso } from '../../lib/date-time/berlin';
import {
  decideOutputFolder,
  selfCheckOutput,
  type OutputDecision,
} from '../../lib/export-profile/output-safety';
import { profileExportFolder } from '../../lib/export-profile/profile-export';
import { renderProfile } from '../../lib/export-profile/profile-report';

// Profiles a customer's export folder (the Sykasoft sample, epic
// werk-flow/werkflow-planning#19) into a structure-only profile.md and
// profile.json that agents may read. Runs offline on the owner's machine:
// no network, and no value from the export reaches the output or this
// terminal. The export and the profile stay outside every Git repository.
//
//   bun scripts/migration/profile-export.ts <export-folder> [--out <folder>] [--mask-labels]

const USAGE = `Usage: bun scripts/migration/profile-export.ts <export-folder> [--out <folder>] [--mask-labels]

  <export-folder>  The unpacked export. It must not be inside a Git repository.
  --out <folder>   Where to write profile.md and profile.json (default:
                   ~/werkflow-export-profiles/<today>/). Must be empty and
                   outside every Git repository.
  --mask-labels    Show every file, sheet, column and folder name as a shape.`;

const REFUSALS: Record<Exclude<OutputDecision, { ok: true }>['reason'], string> = {
  input_missing: 'The export folder does not exist or is not a folder.',
  input_inside_repository:
    'The export folder is inside a Git repository. Move it out (for example to ~/werkflow-exports/) so no commit or agent workspace can pick it up.',
  output_inside_repository:
    'The output folder is inside a Git repository. Choose a folder outside every repository.',
  output_overlaps_input:
    'The output folder and the export folder overlap. Choose an output folder outside the export.',
  output_not_empty: 'The output folder is not empty. Choose an empty or new folder.',
};

const REVIEW = `Before you share the profile with anyone or any agent, open profile.md and check:
  1. Column names. They come from each file's first row. A person's name, an address or a
     customer number there means the file had no header row: run again with --mask-labels.
  2. File, sheet and folder names. A customer or employee name there: run again with --mask-labels.
  3. The Shape column. It holds only X, x, 9, spaces and punctuation.
  4. The database, unreadable and other files. Nothing inside them was read; only names and sizes appear.`;

function main(): number {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: 'string' },
      'mask-labels': { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  const [input] = positionals;
  if (values.help || input === undefined || positionals.length !== 1) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const decision = decideOutputFolder({
    input: resolve(input),
    requestedOutput: values.out === undefined ? null : resolve(values.out),
    home: homedir(),
    today: getBusinessTodayIso(),
  });
  if (!decision.ok) {
    console.error(`Refused: ${REFUSALS[decision.reason]}`);
    return 2;
  }
  console.log('Profiling the export. Nothing leaves this machine.');
  const profile = profileExportFolder(resolve(input), { maskLabels: values['mask-labels'] });
  const report = renderProfile(profile, getBusinessTodayIso());
  const findings = selfCheckOutput([
    { file: 'profile.md', text: report.markdown },
    { file: 'profile.json', text: report.json },
  ]);
  if (findings.length > 0) {
    console.error('SELF-CHECK FAILED: the profile still contains something that looks like personal data.');
    console.error('Nothing was written. The findings name only the place and the kind, never the value:');
    for (const finding of findings)
      console.error(
        `  ${finding.file} line ${finding.line}: ${finding.kind}${finding.section ? ` (section "${finding.section}")` : ''}`,
      );
    console.error(
      values['mask-labels']
        ? 'Do not share anything. Report the lines above (not the export) so the profiler can be fixed.'
        : 'Run again with --mask-labels. If it still fails, do not share anything and report the lines above.',
    );
    return 1;
  }
  mkdirSync(decision.folder, { recursive: true });
  writeFileSync(join(decision.folder, 'profile.md'), report.markdown);
  writeFileSync(join(decision.folder, 'profile.json'), report.json);
  const { files } = profile;
  console.log(
    `Profiled ${files.total} files: ${files.tableFiles} table files (${profile.tables.length} tables), ${files.binaries} database or binary files, ` +
      `${files.documents} documents, ${files.photos} photos, ${files.other} other, ${profile.unreadable.length} unreadable.`,
  );
  console.log(`Self-check passed. Wrote ${join(decision.folder, 'profile.md')} and profile.json.\n`);
  console.log(REVIEW);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  // A file system error message quotes the path, and a path below the export
  // can name a customer. Only the error's name and code are shown.
  const code = error instanceof Error && 'code' in error ? ` (${String(error.code)})` : '';
  console.error(`Failed: ${error instanceof Error ? error.name : 'error'}${code}. Nothing was written.`);
  process.exitCode = 1;
}
