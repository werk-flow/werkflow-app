// What a CI runner's orchestrator starts now, and when to ask again, so no runner waits for a clock
// (werk-flow/werkflow-planning#510). scripts/ci/schedule.ts asks these rules with the runner's
// state; the full-run rule stays lib/testing/ci/full-run.ts, and superseded runs superseded.ts.
import { z } from 'zod';
import type { FullRunDecision } from './full-run';
import { supersedingHead } from './superseded';
import {
  addLocalDays,
  formatBerlinLocalDate,
  getLocalWeekday,
  resolveBerlinWallTime,
} from '../../date-time/berlin';

const HOUR_MS = 3_600_000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

/** Work that starts at a Berlin wall time: its `HH:MM`, its weekdays (0 Monday to 6 Sunday), and how long a missed slot stays due. */
type ClockWork = { time: string; weekdays: readonly number[]; lateMs: number };

export const CLOCK_WORK = {
  /**
   * The release decides at 03:30 on weekdays, so PROD is live by 05:00 Berlin
   * (docs/technical/environments.md, "Release and rollback"). A missed slot still goes on until
   * 16:30, as .github/scripts/hold-until.sh lets a late scheduled run go on at once, and never on
   * another day.
   */
  release: { time: '03:30', weekdays: [0, 1, 2, 3, 4], lateMs: 13 * HOUR_MS },
  /**
   * Every browser group once a day, just after the midnight start window, so it plans no hold
   * (`ciBrowserHoldUntil`) and ends before the release decides on its commit. A head that already
   * has a full run skips it: an unchanged head gets no second full run for the new date alone (the
   * release keeps its own exact-commit gate). A skipped or missed night stays due until the next
   * slot, 23 to 25 hours later, and starts once main moves on (`scheduleDue` also defers it where
   * it would plan a hold or meet a running full run).
   */
  nightly: { time: '00:15', weekdays: EVERY_DAY, lateMs: Number.POSITIVE_INFINITY },
} as const satisfies Record<string, ClockWork>;
export type ClockWorkName = keyof typeof CLOCK_WORK;

/**
 * A missed nightly this close to its next slot waits for that slot: started now, it would plan a
 * midnight hold (`ciBrowserHoldUntil` holds from 22:25 Berlin), and the next slot runs the same
 * full run a few minutes later.
 */
const NIGHTLY_CATCH_UP_CUTOFF_MS = 2 * HOUR_MS;
export const CLOCK_WORK_NAMES = ['release', 'nightly'] as const satisfies readonly ClockWorkName[];

/** The newest slot of each clock work the runner started, as `scripts/ci/schedule.ts started` records it. */
export const scheduleStateSchema = z.object({
  release: z.string().datetime().optional(),
  nightly: z.string().datetime().optional(),
});
export type ScheduleState = z.infer<typeof scheduleStateSchema>;

/** The instant of `work`'s slot on a Berlin date, or undefined when the date holds none. */
function slotOn(work: ClockWork, date: string): Date | undefined {
  if (!work.weekdays.includes(getLocalWeekday(date))) return undefined;
  const resolved = resolveBerlinWallTime(`${date}T${work.time}`);
  if (!resolved) throw new Error(`${date}T${work.time} is no Berlin wall time.`);
  return resolved.instant;
}

/**
 * Whether clock work is due at `now`: its newest slot at or before `now`, while that slot is less
 * than `lateMs` old and the runner started no slot that recent. Missed slots coalesce into the
 * newest. `next` is the first slot after `now`.
 */
export function clockSlot(
  name: ClockWorkName,
  now: Date,
  lastStarted: Date | undefined,
): { due: Date | undefined; next: Date } {
  const work: ClockWork = CLOCK_WORK[name];
  const today = formatBerlinLocalDate(now);
  let latest: Date | undefined;
  let next: Date | undefined;
  // A week back and forward holds a slot of every weekday.
  for (let offset = -7; offset <= 8; offset++) {
    const slot = slotOn(work, addLocalDays(today, offset));
    if (!slot) continue;
    if (slot.getTime() <= now.getTime()) latest = slot;
    else next ??= slot;
  }
  if (!next) throw new Error(`${name} has no slot in the coming week.`);
  const started = lastStarted !== undefined && latest !== undefined && lastStarted >= latest;
  const due = latest && !started && now.getTime() - latest.getTime() < work.lateMs ? latest : undefined;
  return { due, next };
}

/**
 * When a run's held browser shards may start: the plan's `midnight_until` for a run whose plan holds
 * the `midnight` job that has not started yet. The runner starts that job, and the shards behind it,
 * at this time instead of a machine waiting for it (scripts/ci/job.ts midnight).
 */
export function heldUntil(plan: {
  jobs: readonly string[];
  outputs: Readonly<Record<string, string>>;
}): Date | { unreadable: string } | undefined {
  if (!plan.jobs.includes('midnight')) return undefined;
  const until = new Date(plan.outputs.midnight_until ?? '');
  return Number.isNaN(until.getTime())
    ? { unreadable: 'the plan runs the midnight job but sets no readable midnight_until' }
    : until;
}

/** What the runner starts now. */
type Start =
  | { work: ClockWorkName; slot: string; reason: string }
  | { work: 'full'; reason: string }
  | { work: 'midnight'; run: string; reason: string };

export type ScheduleAnswer = {
  start: Start[];
  /** Runs the runner stops: a pull request's run whose head moved on. */
  stop: { run: string; reason: string }[];
  /** What could not be decided; the runner reports it, and asks again. */
  unanswered: { work: string; reason: string }[];
  /** The next time clock work or a held run falls due; ask again then at the latest. */
  wakeAt: string;
};

/**
 * Everything due at `now`. A due nightly waits while a full run runs, and a missed one waits for
 * the next slot when that is near (`NIGHTLY_CATCH_UP_CUTOFF_MS`); it skips a head the full-run rule
 * says already has a full run. A nightly that starts now is main's full run too, so the full-run
 * rule starts no second one beside it. A pull request run stops only when its PR's head moved
 * past the commit it tests; an unanswered question keeps it running.
 */
export function scheduleDue(input: {
  now: Date;
  state: ScheduleState;
  /** `bun scripts/ci/full-run.ts due` on main's head, or why it gave no answer. */
  fullRun: () => FullRunDecision | { unreadable: string };
  /**
   * Whether GitHub's schedule starts the release (a `schedule` trigger in release.yml), or why
   * release.yml cannot say. Only without one does the runner dispatch it, so one weekday never
   * gets two releases.
   */
  releaseOnCron: boolean | { unreadable: string };
  /** Whether a full run runs now (`fullRunsInLedger`), or why the ledger cannot say; then the nightly starts. */
  fullRunning: boolean | { unreadable: string };
  /** The runs that wait for their browser shards, with `heldUntil` of each one's plan. */
  held: readonly { run: string; until: ReturnType<typeof heldUntil> }[];
  /** The pull request runs in progress: the ref that holds the PR's head, and the commit the run tests. */
  prRuns: readonly { run: string; headRef: string; testedHead: string }[];
  remoteHead: (ref: string) => string | undefined;
}): ScheduleAnswer {
  const answer: ScheduleAnswer = { start: [], stop: [], unanswered: [], wakeAt: '' };
  const wakes: number[] = [];
  let decision: ReturnType<typeof input.fullRun> | undefined;
  const fullRun = (): ReturnType<typeof input.fullRun> => (decision ??= input.fullRun());
  const headTested = (): boolean => {
    const answered = fullRun();
    return !('unreadable' in answered) && answered.headHasFullRun === true;
  };
  for (const work of CLOCK_WORK_NAMES) {
    if (work === 'release' && input.releaseOnCron !== false) {
      if (input.releaseOnCron !== true)
        answer.unanswered.push({ work, reason: input.releaseOnCron.unreadable });
      continue;
    }
    const recorded = input.state[work];
    const { due, next } = clockSlot(work, input.now, recorded ? new Date(recorded) : undefined);
    wakes.push(next.getTime());
    const nightlyWaits =
      next.getTime() - input.now.getTime() < NIGHTLY_CATCH_UP_CUTOFF_MS || input.fullRunning === true;
    if (due && work === 'nightly' && (nightlyWaits || headTested())) continue;
    if (due && work === 'nightly' && typeof input.fullRunning === 'object')
      answer.unanswered.push({
        work,
        reason: `Whether a full run runs is unknown: ${input.fullRunning.unreadable}`,
      });
    if (due)
      answer.start.push({
        work,
        slot: due.toISOString(),
        reason: `${work === 'release' ? 'The release' : 'The nightly full run'} is due since ${CLOCK_WORK[work].time} Berlin time.`,
      });
  }
  if (!answer.start.some((start) => start.work === 'nightly')) {
    const answered = fullRun();
    if ('unreadable' in answered) answer.unanswered.push({ work: 'full', reason: answered.unreadable });
    else if (answered.run) answer.start.push({ work: 'full', reason: answered.reason });
  }
  for (const { run, until } of input.held) {
    if (until === undefined) continue;
    if (!(until instanceof Date))
      answer.unanswered.push({ work: 'midnight', reason: `${run}: ${until.unreadable}` });
    else if (until.getTime() <= input.now.getTime())
      answer.start.push({
        work: 'midnight',
        run,
        reason: `The midnight start window closed at ${until.toISOString()}; its browser shards follow.`,
      });
    else wakes.push(until.getTime());
  }
  for (const { run, headRef, testedHead } of input.prRuns) {
    const newer = supersedingHead({ event: 'pr', headRef, testedHead, remoteHead: input.remoteHead });
    if (newer) answer.stop.push({ run, reason: `${headRef} moved on from ${testedHead} to ${newer}.` });
  }
  answer.wakeAt = new Date(Math.min(...wakes)).toISOString();
  return answer;
}
