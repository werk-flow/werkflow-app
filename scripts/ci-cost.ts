import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formatCost, summarizeCost } from '../lib/testing/ci-cost/summary';
import { type CiResult, readLedger, readResult } from '../lib/testing/ci/results';

// What CI cost per merged pull request (lib/testing/ci-cost/summary.ts): job-minutes, machine starts, setup
// share, reuse rate and ready-to-merge time.
// Usage: bun scripts/ci-cost.ts [--json] <ledger.jsonl | results folder>...
// A file is a runner's ledger (CI_LEDGER of scripts/ci/job.ts). A folder holds run folders of
// results (CI_RESULTS_DIR), searched to any depth for `.json` files. An unreadable input fails.

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

const json = process.argv.includes('--json');
const paths = process.argv.slice(2).filter((argument) => argument !== '--json');
if (!paths.length)
  throw new Error('Usage: bun scripts/ci-cost.ts [--json] <ledger.jsonl | results folder>...');
const summary = summarizeCost(paths.flatMap(receiptsOf));
console.info(json ? JSON.stringify(summary, null, 2) : formatCost(summary));
