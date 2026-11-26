import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { liveIo, runProgram } from '../lib/production-watch/live-io';
import { readState, watch } from '../lib/production-watch/watch';

/**
 * `bun scripts/prod-watch.ts <state file>`: one pass of the production watcher
 * (lib/production-watch/watch.ts), run every 10 minutes by .github/workflows/prod-watch.yml. It
 * reads the state the last pass saved, writes the state for the next one, and prints fixed verdicts
 * only, because the job's log is public. Exit 1 means a failed pass, which counts toward
 * "Production alert: watcher".
 */
async function main(): Promise<number> {
  const statePath = process.argv[2];
  if (!statePath) {
    console.error('Usage: bun scripts/prod-watch.ts <state file>');
    return 2;
  }
  let saved: unknown = {};
  if (existsSync(statePath)) {
    try {
      saved = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      console.log('production: the saved state is unreadable; this pass starts fresh');
    }
  }
  const state = readState(saved);
  const { notes, failed } = await watch(liveIo(process.env, fetch, runProgram), state, Date.now());
  for (const note of notes) console.log(note);
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    console.log(`production: the state was not saved: ${failureName(error)}`);
    return 1;
  }
  console.log(failed ? 'production: the pass failed' : 'production: the pass is done');
  return failed ? 1 : 0;
}

/** An error's kind only: its message may hold a path or a response, and the log is public. */
const failureName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown failure');

process.exit(
  await main().catch((error: unknown) => {
    console.log(`production: the pass stopped: ${failureName(error)}`);
    return 1;
  }),
);
