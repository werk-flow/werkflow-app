import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { PlaywrightSuite } from "./run-policy";
import { getSpawnFailureDetail } from "./spawn-result";

/** The repository-owned Playwright configuration per suite; the default config serves the golden suite. */
export const SUITE_CONFIG: Record<PlaywrightSuite, readonly string[]> = {
  golden: [],
  audit: ["--config", "playwright.audit.config.ts"],
  canary: ["--config", "playwright.canary.config.ts"],
};

export const discoveredTestSchema = z.object({
  id: z.string(),
  file: z.string(),
  title: z.string(),
  annotations: z.array(z.object({ type: z.string(), description: z.string().optional() })),
});
export type DiscoveredPlaywrightTest = z.infer<typeof discoveredTestSchema>;
export type PlaywrightSelection = { tests: DiscoveredPlaywrightTest[]; titles: string[]; total: number };

export function selectionOf(tests: readonly DiscoveredPlaywrightTest[]): PlaywrightSelection {
  const titles = tests.map((test) => test.id);
  if (new Set(titles).size !== titles.length) throw new Error("Playwright discovery did not return unique test identities.");
  return { tests: [...tests], titles, total: titles.length };
}

/** The tests of a suite discovery that live in the given files, in discovery order. */
export function selectionForFiles(selection: PlaywrightSelection, files: readonly string[]): PlaywrightSelection {
  return selectionOf(selection.tests.filter((test) => files.includes(test.file)));
}

/**
 * Lists a suite's tests through Playwright's own discovery (about ten seconds
 * per suite). A verification run discovers each suite once and hands the
 * result to every group it starts; a direct lane discovers for itself.
 */
export function discoverPlaywrightSelection(input: {
  suite: PlaywrightSuite;
  playwrightArgs: readonly string[];
  repositoryRoot: string;
  signal?: AbortSignal;
}): PlaywrightSelection {
  input.signal?.throwIfAborted();
  const result = spawnSync(process.execPath, [
    "x", "playwright", "test", ...SUITE_CONFIG[input.suite], ...input.playwrightArgs,
    "--list", "--reporter", "./tests/golden/support/discovery-reporter.ts",
  ], { cwd: input.repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000, windowsHide: true });
  input.signal?.throwIfAborted();
  if (result.error) throw new Error(`Playwright discovery failed or exceeded its 60-second deadline: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Could not discover ${input.suite} tests: ${getSpawnFailureDetail(result, `Playwright exited ${result.status}`)}`);
  const line = result.stdout.split(/\r?\n/).findLast((candidate) => candidate.startsWith("["));
  return selectionOf(z.array(discoveredTestSchema).parse(line ? JSON.parse(line) : null));
}
