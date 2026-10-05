import { runSessionCommand } from '../local-stack/local-stack-lease';
import { z } from 'zod';
import type { PlaywrightSuite } from './run-policy';
import { type TestGroup } from '../selection/test-groups';

/** Discover only the selected groups, without unrelated setup journeys. */
export function selectedDiscoveryArguments(groups: readonly TestGroup[], suite: PlaywrightSuite): string[] {
  return [...new Set(groups.filter((group) => group.kind === suite).flatMap((group) => group.files))].map(
    (file) => file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
  );
}

/** The repository-owned Playwright configuration per suite; the default config serves the golden suite. */
export const SUITE_CONFIG: Record<PlaywrightSuite, readonly string[]> = {
  golden: [],
  audit: ['--config', 'playwright.audit.config.ts'],
  canary: ['--config', 'playwright.canary.config.ts'],
};

export const discoveredTestSchema = z.object({
  id: z.string(),
  file: z.string(),
  title: z.string(),
});
export type DiscoveredPlaywrightTest = z.infer<typeof discoveredTestSchema>;
export type PlaywrightSelection = { tests: DiscoveredPlaywrightTest[]; titles: string[]; total: number };

export function selectionOf(tests: readonly DiscoveredPlaywrightTest[]): PlaywrightSelection {
  const titles = tests.map((test) => test.id);
  if (new Set(titles).size !== titles.length)
    throw new Error('Playwright discovery did not return unique test identities.');
  return { tests: [...tests], titles, total: titles.length };
}

/** The tests of a suite discovery that live in the given files, in discovery order. */
export function selectionForFiles(
  selection: PlaywrightSelection,
  files: readonly string[],
): PlaywrightSelection {
  return selectionOf(selection.tests.filter((test) => files.includes(test.file)));
}

/**
 * Lists a suite's tests through Playwright's own discovery (about ten seconds
 * per suite). A verification run discovers each suite once and hands the
 * result to every group it starts; a direct lane discovers for itself.
 */
export async function discoverPlaywrightSelection(input: {
  suite: PlaywrightSuite;
  playwrightArgs: readonly string[];
  repositoryRoot: string;
  signal?: AbortSignal;
}): Promise<PlaywrightSelection> {
  input.signal?.throwIfAborted();
  const outputLimit = new AbortController();
  const signal = AbortSignal.any([
    AbortSignal.timeout(60_000),
    outputLimit.signal,
    ...(input.signal ? [input.signal] : []),
  ]);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let bytes = 0;
  const collect = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) {
      outputLimit.abort(new Error('Playwright discovery exceeded its output limit.'));
      return;
    }
    if (stream === 'stdout') stdout.push(chunk);
    else stderr.push(chunk);
  };
  const status = await runSessionCommand(
    [
      process.execPath,
      'x',
      'playwright',
      'test',
      ...SUITE_CONFIG[input.suite],
      ...input.playwrightArgs,
      '--list',
      '--reporter',
      './tests/golden/support/discovery-reporter.ts',
    ],
    {
      cwd: input.repositoryRoot,
      signal,
      onStdout: (chunk) => collect('stdout', chunk),
      onStderr: (chunk) => collect('stderr', chunk),
    },
  );
  const output = Buffer.concat(stdout).toString('utf8');
  if (status !== 0)
    throw new Error(
      `Could not discover ${input.suite} tests: ${Buffer.concat(stderr).toString('utf8').trim() || output.trim() || `Playwright exited ${status}`}`,
    );
  const line = output.split(/\r?\n/).findLast((candidate) => candidate.startsWith('['));
  return selectionOf(z.array(discoveredTestSchema).parse(line ? JSON.parse(line) : null));
}
