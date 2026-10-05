import { setTimeout as sleep } from 'node:timers/promises';
import { resolveBusinessDate } from './business-date';

/**
 * No browser group starts from 23:40 to 00:10 Berlin time. A group snapshots
 * its business date when it starts, so a group that crosses midnight checks the
 * old day against an application that already shows the new one. The lead
 * covers the longest recorded group (`audit:wave-1:a1`: median about 8, maximum
 * 13.6 minutes in the reports up to October 2026) with headroom. The trail is
 * A3-R02's precondition of ten completed Berlin minutes after midnight.
 */
export const MIDNIGHT_START_WINDOW = { leadMs: 20 * 60_000, trailMs: 10 * 60_000 } as const;

const HOUR_MS = 3_600_000;

/** Berlin is UTC+1 or UTC+2 and changes offset at 02:00 or 03:00 local time, never at midnight. */
function berlinMidnight(date: string): number {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const summerMidnight = utcMidnight - 2 * HOUR_MS;
  return resolveBusinessDate(undefined, new Date(summerMidnight)) === date
    ? summerMidnight
    : utcMidnight - HOUR_MS;
}

/** Milliseconds until a browser group may start: zero outside the midnight window, never more than the window. */
export function midnightStartWaitMs(now: Date): number {
  const time = now.getTime();
  const midnight = berlinMidnight(
    resolveBusinessDate(undefined, new Date(time + MIDNIGHT_START_WINDOW.leadMs)),
  );
  const closesAt = midnight + MIDNIGHT_START_WINDOW.trailMs;
  return time >= midnight - MIDNIGHT_START_WINDOW.leadMs && time < closesAt ? closesAt - time : 0;
}

/** Holds a browser group until the midnight window closes; the signal cancels the wait. */
export async function waitOutsideMidnightWindow(input: {
  groupId: string;
  signal: AbortSignal;
  log: (line: string) => void;
  now?: () => Date;
}): Promise<void> {
  const now = input.now?.() ?? new Date();
  const waitMs = midnightStartWaitMs(now);
  if (!waitMs) return;
  input.log(
    `${input.groupId}: Berlin time is inside the midnight start window (23:40 to 00:10), where a group's business date can change or its day is too young; waiting ${Math.ceil(waitMs / 60_000)} min until ${new Date(now.getTime() + waitMs).toISOString()} (00:10 Berlin).`,
  );
  await sleep(waitMs, undefined, { signal: input.signal });
}

/**
 * Changed-spec-first (docs/technical/testing.md, How selection works): in a
 * change plan the browser groups whose own test code changed form the first
 * tier. When one of them fails, the groups of the later tier are blocked for
 * this attempt only, so a wrong new or rewritten spec costs its own run and
 * not the whole plan. The blocked groups run in the repair plan.
 */
export function changedTestsFirstBlock(failedFirstTierGroupIds: readonly string[]): string | undefined {
  if (!failedFirstTierGroupIds.length) return undefined;
  return `Changed-spec tier failed (${[...failedFirstTierGroupIds].sort().join(', ')}); the groups selected only by product scope wait for its repair.`;
}

/**
 * Independent browser groups share only the immutable application build and
 * run side by side on `jobs` workers; a group whose timing or database gate is
 * exclusive waits for the batch to drain and runs alone. With `tier`, every
 * entry of a lower tier finishes before the first entry of the next starts.
 */
export async function runGroupSchedule<T>(input: {
  entries: readonly T[];
  jobs: number;
  canOverlap: (entry: T) => boolean;
  run: (entry: T) => Promise<void>;
  tier?: (entry: T) => number;
}): Promise<void> {
  const jobs = Math.max(1, Math.floor(input.jobs));
  let batch: T[] = [];
  const flush = async (): Promise<void> => {
    // One shared iterator: each worker takes the next entry whenever it is free.
    // After a runner error no worker claims another entry; active entries finish.
    const queue = batch.values();
    let stopped = false;
    const workers = Array.from({ length: Math.min(jobs, batch.length) }, async () => {
      for (let next = queue.next(); !stopped && !next.done; next = queue.next()) {
        try {
          await input.run(next.value);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    });
    const outcomes = await Promise.allSettled(workers);
    batch = [];
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  };
  let currentTier: number | undefined;
  for (const entry of input.entries) {
    const tier = input.tier?.(entry);
    if (tier !== currentTier) await flush();
    currentTier = tier;
    if (input.canOverlap(entry)) batch.push(entry);
    else {
      await flush();
      await input.run(entry);
    }
  }
  await flush();
}
