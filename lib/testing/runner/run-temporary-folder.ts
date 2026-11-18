import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A unit run gets its own TMPDIR, so what it leaves behind is its own and
// does not depend on what other processes on a shared machine put in /tmp.
// A test makes its folders with temporaryDirectory (lib/testing/temporary-
// directory.ts), and code under test removes its own in `finally`; anything
// left when the run ends fails it by name. The folder is removed either way.

export type RunTemporaryResult = {
  exitCode: number;
  /** The entries the run left in its TMPDIR, sorted. */
  leftovers: string[];
};

/** Runs `run` with TMPDIR pointed at a fresh folder, and fails it when it leaves anything there. */
export async function withRunTemporaryFolder(run: () => Promise<number>): Promise<RunTemporaryResult> {
  const folder = mkdtempSync(join(tmpdir(), 'werkflow-unit-tmp-'));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = folder;
  try {
    const exitCode = await run();
    const leftovers = readdirSync(folder).sort();
    return { exitCode: leftovers.length ? 1 : exitCode, leftovers };
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(folder, { recursive: true, force: true });
  }
}

/** The failure line for a run that left entries in its TMPDIR. */
export function describeLeftovers(leftovers: readonly string[]): string {
  return `[unit-tmp] The run left these in its TMPDIR: ${leftovers.join(', ')}. Make test folders with temporaryDirectory (lib/testing/temporary-directory.ts); code under test removes its own in finally.`;
}
