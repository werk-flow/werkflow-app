import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { z } from '../../zod';

// Which files of a Boat run's new evidence come back to the workstation (scripts/boat/remote-verify.sh,
// docs/technical/boat-verification.md). Every file a workstation command reads returns: reports,
// diagnoses and group logs, run manifests and runner logs, latency, lab and workload archives, the
// archived world state, acceptance captures and the test server's log. A browser run's per-test
// output (error context, screenshots, traces) returns when the run or its group did not pass, for
// diagnosis and `test:runs classify`. Three things stay on the machine, because no workstation command
// reads them: a passed run's per-test output, every run's HTML report, whose data repeats that output,
// and the active copy of its world, which the run archived under `state/`. They were most of a run's
// download: a passed browser group's report and active world alone weigh 10 to 200 MB.

/** A browser run's folder, as the machine lists it among the run's new evidence. */
const RUN_FOLDER = /^\.agent-logs\/playwright-runs\/[^/]+$/;
/** A verification report's folder. */
const REPORT_FOLDER = /^\.agent-logs\/verification\/[^/]+$/;
/** The parts of a browser run that no workstation command reads. */
const NEVER_READ = ['active/', 'playwright/report/'];
/** A browser run's per-test output, read only to diagnose a run that did not pass. */
const DIAGNOSTICS = 'playwright/results/';

const reportSchema = z.object({
  results: z.array(z.object({ status: z.string(), runKey: z.string().nullable() })),
});
const manifestSchema = z.object({ status: z.string() });

export type ResultSelection = {
  /** The files that come back, relative to the checkout. */
  files: string[];
  /** The bytes left on the machine. */
  leftOutBytes: number;
  /** The browser runs whose per-test output stays on the machine. */
  passedRuns: number;
};

/** Every entry under `folder` that is not a folder, symbolic links included, relative to `repository`. */
function entriesUnder(repository: string, folder: string): string[] {
  return readdirSync(join(repository, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(repository, join(entry.parentPath, entry.name)));
}

/** The browser runs whose group result in one of the new reports did not pass. */
function unpassedRuns(repository: string, folders: readonly string[]): Set<string> {
  const runs = new Set<string>();
  for (const folder of folders.filter((candidate) => REPORT_FOLDER.test(candidate))) {
    let text: string;
    try {
      text = readFileSync(join(repository, folder, 'report.json'), 'utf8');
    } catch {
      continue;
    }
    for (const result of reportSchema.parse(JSON.parse(text)).results)
      if (result.status !== 'passed' && result.runKey) runs.add(result.runKey);
  }
  return runs;
}

/**
 * Whether a browser run passed: its manifest says so and no new report records its group as not
 * passed. A group fails on its latency or lab evidence after Playwright passed, and its traces then
 * serve the diagnosis. An unreadable manifest counts as not passed.
 */
function runPassed(repository: string, folder: string, unpassed: ReadonlySet<string>): boolean {
  if (unpassed.has(basename(folder))) return false;
  try {
    const manifest = readFileSync(join(repository, folder, 'manifest.json'), 'utf8');
    return manifestSchema.parse(JSON.parse(manifest)).status === 'passed';
  } catch {
    return false;
  }
}

/**
 * The files of `folders`, the evidence folders a run wrote, that come back to the workstation. A
 * symbolic link or special file is listed like any other, so the import still refuses it.
 */
export function resultFiles(repository: string, folders: readonly string[]): ResultSelection {
  const unpassed = unpassedRuns(repository, folders);
  const selection: ResultSelection = { files: [], leftOutBytes: 0, passedRuns: 0 };
  for (const folder of folders) {
    const entries = entriesUnder(repository, folder);
    if (!RUN_FOLDER.test(folder)) {
      selection.files.push(...entries);
      continue;
    }
    const passed = runPassed(repository, folder, unpassed);
    if (passed) selection.passedRuns++;
    for (const path of entries) {
      const inside = path.slice(folder.length + 1);
      if (NEVER_READ.some((part) => inside.startsWith(part)) || (passed && inside.startsWith(DIAGNOSTICS)))
        selection.leftOutBytes += lstatSync(join(repository, path)).size;
      else selection.files.push(path);
    }
  }
  return selection;
}
