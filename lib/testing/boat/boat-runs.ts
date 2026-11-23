// What each Boat verification run cost, kept in the checkout's evidence history beside its reports, so
// scripts/ci-cost.ts can count Boat beside CI (council round 2, R2-9; werk-flow/werkflow-planning#503).
// A record holds synthetic metadata only: the machine's id, the run's times, Boat's usage counter, the
// commit it tested and the report folders it returned. Recording never fails a run.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from '../../zod';

/** The records of a checkout, one JSON line per Boat run. */
export const BOAT_RUNS_FILE = '.agent-logs/boat-runs.jsonl';

const boatRunSchema = z
  .object({
    version: z.literal(1),
    /** The Boat machine that ran it; a kept machine serves several runs of its checkout. */
    machine: z.string().regex(/^bx_[a-z0-9]{8}$/),
    /** When its machine was ready: a fresh machine's start is in its dollars, not its wall time. */
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    /** The commit the run's checkout stood on, or null when git could not say. */
    head: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable(),
    /** The report folders under .agent-logs/verification the run returned. */
    reports: z.array(z.string().min(1)),
    /** Boat's usage of the machine so far, as it answered after the run; null when it did not answer. */
    usage: z.object({ seconds: z.number().nonnegative(), dollars: z.number().nonnegative() }).nullable(),
  })
  .strict();
export type BoatRun = z.infer<typeof boatRunSchema>;

const REPORTS = '.agent-logs/verification';

/** The report folders of the checkout now, to tell which ones a run returned. */
function reportFolders(repository: string): Set<string> {
  const folder = join(repository, REPORTS);
  return new Set(existsSync(folder) ? readdirSync(folder) : []);
}

/**
 * A run's start: when its machine was ready, the commit it tests, and the report folders the
 * checkout held then.
 */
type BoatRunStart = { startedAt: string; head: string | null; reports: ReadonlySet<string> };

/**
 * The run's start with `head`, the commit packing read (`testedCommit`), or undefined when the
 * checkout's reports cannot be read: the record is best effort.
 */
export function boatRunStart(repository: string, head: string | null): BoatRunStart | undefined {
  try {
    return { startedAt: new Date().toISOString(), head, reports: reportFolders(repository) };
  } catch (error) {
    console.warn(
      `[verify] The Boat run's cost is not recorded: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * The commit a run tests, from the HEAD and the changed or untracked files its packing read, so a
 * commit made during the run is never recorded in its place. Null when it tests more than a commit,
 * or `head` is no commit id: such a run counts to no PR.
 */
export function testedCommit(head: string, changed: readonly string[]): string | null {
  return changed.length === 0 && /^[0-9a-f]{40}$/.test(head) ? head : null;
}

/**
 * Appends the record of a run that ends now: the report folders it returned and Boat's usage of
 * its machine. A failure only warns, because the record measures and gates nothing.
 */
export function recordBoatRun(
  repository: string,
  run: { machine: string; started: BoatRunStart; usage: { seconds: number; dollars: number } | undefined },
): void {
  const path = join(repository, BOAT_RUNS_FILE);
  try {
    const record = boatRunSchema.parse({
      version: 1,
      machine: run.machine,
      startedAt: run.started.startedAt,
      completedAt: new Date().toISOString(),
      head: run.started.head,
      reports: [...reportFolders(repository)].filter((report) => !run.started.reports.has(report)).sort(),
      usage: run.usage ? { seconds: run.usage.seconds, dollars: run.usage.dollars } : null,
    });
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.warn(
      `[verify] The Boat run's cost record was not kept: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Every record of a file, or why none can count: one unreadable line could hide a run. */
export function readBoatRuns(path: string): BoatRun[] | { unreadable: string } {
  if (!existsSync(path)) return [];
  const runs: BoatRun[] = [];
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = boatRunSchema.safeParse(JSON.parse(line));
      if (!parsed.success) return { unreadable: `${path}:${index + 1} is no Boat run record` };
      runs.push(parsed.data);
    } catch {
      return { unreadable: `${path}:${index + 1} is no JSON` };
    }
  }
  return runs;
}

/**
 * Each run's own dollars. Boat's counter is the machine's total so far, and a kept machine serves the
 * checkout's next run, so a run costs its counter minus the machine's counter after the run before
 * it: idle time between them counts to the later run. Null when Boat gave no counter for the run or
 * for the machine's run before it.
 */
export function boatRunDollars(runs: readonly BoatRun[]): { run: BoatRun; dollars: number | null }[] {
  const ordered = runs.toSorted((left, right) => left.completedAt.localeCompare(right.completedAt));
  const last = new Map<string, number | null>();
  return ordered.map((run) => {
    const before = last.has(run.machine) ? last.get(run.machine) : 0;
    const now = run.usage?.dollars ?? null;
    last.set(run.machine, now);
    return {
      run,
      dollars: now === null || before === null || before === undefined ? null : Math.max(0, now - before),
    };
  });
}
