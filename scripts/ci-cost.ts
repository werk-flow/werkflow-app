import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type BoatRun, readBoatRuns } from '../lib/testing/boat/boat-runs';
import { formatCost, summarizeCost } from '../lib/testing/ci-cost/summary';
import { type CiResult, readLedger, readResult } from '../lib/testing/ci/results';

// What CI cost per merged pull request (lib/testing/ci-cost/summary.ts): job-minutes, machine starts, setup
// share, reuse rate and ready-to-merge time, and the Boat verification runs beside them.
// Usage: bun scripts/ci-cost.ts [--json] [--boat <boat-runs.jsonl>]... <ledger.jsonl | results folder>...
// A file is a runner's ledger (CI_LEDGER of scripts/ci/job.ts). A folder holds run folders of
// results (CI_RESULTS_DIR), searched to any depth for `.json` files. --boat names a checkout's
// .agent-logs/boat-runs.jsonl (lib/testing/boat/boat-runs.ts); pass every checkout's, since a kept
// machine can serve another checkout. An unreadable input fails.

/** Every result file under `folder`, at any depth. */
function resultFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return resultFiles(path);
    return entry.name.endsWith('.json') ? [path] : [];
  });
}

function receiptsOf(path: string): CiResult[] {
  if (statSync(path).isDirectory()) {
    const results = resultFiles(path).map((file) => readResult(file));
    const unreadable = results.find((entry) => 'unreadable' in entry);
    if (unreadable && 'unreadable' in unreadable) throw new Error(unreadable.unreadable);
    return results
      .filter((entry): entry is CiResult => !('unreadable' in entry))
      .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
  }
  const ledger = readLedger(path);
  if ('unreadable' in ledger) throw new Error(ledger.unreadable);
  return ledger;
}

function boatRunsOf(path: string): BoatRun[] {
  // A path given by name must exist: a mistyped one would report no Boat runs at all.
  if (!existsSync(path)) throw new Error(`${path} does not exist.`);
  const runs = readBoatRuns(path);
  if ('unreadable' in runs) throw new Error(runs.unreadable);
  return runs;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: 'boolean', default: false }, boat: { type: 'string', multiple: true } },
});
if (!positionals.length)
  throw new Error(
    'Usage: bun scripts/ci-cost.ts [--json] [--boat <boat-runs.jsonl>]... <ledger.jsonl | results folder>...',
  );
const summary = summarizeCost(positionals.flatMap(receiptsOf), values.boat?.flatMap(boatRunsOf));
console.info(values.json ? JSON.stringify(summary, null, 2) : formatCost(summary));
