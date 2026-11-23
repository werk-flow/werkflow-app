// When a CI machine may run, and at which size (werk-flow/werkflow-planning#503, P8). Each machine
// keeps one window file outside the repo: a standing weekly rule plus dated exceptions, in Berlin
// wall time. The runner asks `admitRun` before each run and alerts on a `hold`.
import { z } from 'zod';
import {
  addLocalDays,
  BERLIN_TIME_ZONE,
  formatBerlinLocalDate,
  getLocalWeekday,
  resolveBerlinWallTime,
} from '../../date-time/berlin';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_MINUTES = 1_440;
const WEEK_MINUTES = 7 * DAY_MINUTES;
/** The size that admits no run. Every other size is a label the machine's own config defines. */
const OFF = 'off';

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'is no Berlin wall time HH:MM');
const size = z.string().min(1, 'names no size');

const standingRuleSchema = z.strictObject({
  days: z.array(z.enum(DAYS)).min(1, 'names no day'),
  /** Inclusive. */
  from: clockTime,
  /** Exclusive; at or before `from` it is on the next day, so equal times cover 24 hours. */
  to: clockTime,
  size,
});

const exceptionSchema = z
  .strictObject({
    date: z.iso.date(),
    /** Inclusive, Berlin time on `date`. */
    from: clockTime,
    /** Exclusive, Berlin time on the same `date`. */
    to: clockTime,
    size,
    reason: z.string().min(1, 'gives no reason'),
  })
  .refine((exception) => exception.from < exception.to, 'must end after it starts on the same date');

type StandingRule = z.infer<typeof standingRuleSchema>;
type WindowException = z.infer<typeof exceptionSchema>;

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The minutes of the week a standing rule covers, Monday 00:00 as 0, ignoring clock changes. */
function weekMinutes(rule: StandingRule): number[] {
  const from = minutesOf(rule.from);
  const to = minutesOf(rule.to);
  const length = to > from ? to - from : to + DAY_MINUTES - from;
  return rule.days.flatMap((day) => {
    const start = DAYS.indexOf(day) * DAY_MINUTES + from;
    return Array.from({ length }, (_, offset) => (start + offset) % WEEK_MINUTES);
  });
}

const clockOfWeek = (minute: number): string => {
  const day = DAYS[Math.floor(minute / DAY_MINUTES)] ?? '?';
  const inDay = minute % DAY_MINUTES;
  return `${day} ${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`;
};

const windowFileSchema = z
  .strictObject({
    timezone: z.literal(BERLIN_TIME_ZONE),
    standing: z.array(standingRuleSchema).min(1, 'names no standing rule'),
    exceptions: z.array(exceptionSchema).optional(),
  })
  .superRefine((file, context) => {
    const owner = new Array<number | undefined>(WEEK_MINUTES);
    file.standing.forEach((rule, index) => {
      for (const minute of weekMinutes(rule)) {
        const earlier = owner[minute];
        if (earlier !== undefined) {
          context.addIssue({
            code: 'custom',
            path: ['standing', index],
            message: `overlaps standing rule ${earlier} at ${clockOfWeek(minute)}`,
          });
          return;
        }
        owner[minute] = index;
      }
    });
    const gap = Array.from(owner.keys()).find((minute) => owner[minute] === undefined);
    if (gap !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['standing'],
        message: `leaves ${clockOfWeek(gap)} uncovered`,
      });
    const exceptions = file.exceptions ?? [];
    exceptions.forEach((exception, index) => {
      const other = exceptions.findIndex(
        (earlier, earlierIndex) =>
          earlierIndex < index &&
          earlier.date === exception.date &&
          earlier.from < exception.to &&
          exception.from < earlier.to,
      );
      if (other >= 0)
        context.addIssue({
          code: 'custom',
          path: ['exceptions', index],
          message: `overlaps exception ${other} on ${exception.date}`,
        });
    });
  });
export type WindowFile = z.infer<typeof windowFileSchema>;

/** The Mac: two jobs at night, one by day, every day. */
export const MAC_STANDING = [
  { days: [...DAYS], from: '20:00', to: '05:00', size: '8/8' },
  { days: [...DAYS], from: '05:00', to: '20:00', size: '4/6' },
] as const satisfies readonly StandingRule[];

/** The PC: no CI Monday and Friday 06:00 to 17:00, full use at every other time. */
export const PC_STANDING = [
  { days: ['tue', 'wed', 'thu', 'sat', 'sun'], from: '00:00', to: '00:00', size: 'full' },
  { days: ['mon', 'fri'], from: '00:00', to: '06:00', size: 'full' },
  { days: ['mon', 'fri'], from: '06:00', to: '17:00', size: OFF },
  { days: ['mon', 'fri'], from: '17:00', to: '00:00', size: 'full' },
] as const satisfies readonly StandingRule[];

/** `null` once the answer never changes again. */
type Until = Date | null;

export type WindowAnswer =
  | { kind: 'open'; size: string; until: Until }
  | { kind: 'off'; until: Until }
  | { kind: 'hold'; reason: string };

export type Admission =
  | { admit: true; size: string }
  /** `retryAt` is null on a hold, or when no window ahead is long enough. */
  | { admit: false; retryAt: Date | null; reason: string };

type Segment = { start: number; end: number; size: string };

const HOUR_MS = 3_600_000;

/**
 * A Berlin wall time as an instant: a time in the spring gap is the gap's end, an autumn time that
 * occurs twice is its first occurrence. Both keep the order of wall times, so rules that cover the
 * week cover every instant. `resolveBerlinWallTime` shifts a gap time forward by the gap instead,
 * which would put 02:30 after 03:00; Berlin's gap ends on a whole UTC hour (01:00 UTC), so the
 * shifted instant floors to it.
 */
function wallInstant(date: string, time: string): number {
  const resolved = resolveBerlinWallTime(`${date}T${time}`);
  if (!resolved) throw new Error(`${date}T${time} is no Berlin wall time.`);
  const instant = resolved.instant.getTime();
  return resolved.resolution === 'shifted_forward' ? Math.floor(instant / HOUR_MS) * HOUR_MS : instant;
}

/**
 * The window from the day before `now` to a week past the later of `now` and the last exception,
 * as contiguous segments with neighbours of one size merged. The last segment ends at `null` when
 * it spans a whole week without an exception: the standing rule then never changes it.
 */
function timeline(file: WindowFile, now: Date): { start: number; end: number | null; size: string }[] {
  const today = formatBerlinLocalDate(now);
  const exceptions = file.exceptions ?? [];
  const lastDate = addLocalDays(
    exceptions.reduce((latest, exception) => (exception.date > latest ? exception.date : latest), today),
    8,
  );
  const horizon = wallInstant(lastDate, '00:00');
  const standing: Segment[] = [];
  for (let date = addLocalDays(today, -1); date < lastDate; date = addLocalDays(date, 1)) {
    const day = DAYS[getLocalWeekday(date)];
    for (const rule of file.standing) {
      if (day === undefined || !rule.days.includes(day)) continue;
      const start = wallInstant(date, rule.from);
      const end = wallInstant(rule.to > rule.from ? date : addLocalDays(date, 1), rule.to);
      standing.push({ start, end: Math.min(end, horizon), size: rule.size });
    }
  }
  const overrides: Segment[] = exceptions.map((exception: WindowException) => ({
    start: wallInstant(exception.date, exception.from),
    end: wallInstant(exception.date, exception.to),
    size: exception.size,
  }));
  const covering = (segments: Segment[], instant: number): Segment | undefined =>
    segments.find((segment) => segment.start <= instant && instant < segment.end);
  const bounds = [...new Set([...standing, ...overrides].flatMap((segment) => [segment.start, segment.end]))]
    .filter((bound) => bound <= horizon)
    .sort((left, right) => left - right);
  const merged: Segment[] = [];
  bounds.slice(0, -1).forEach((start, index) => {
    const end = bounds[index + 1] ?? start;
    const sizeHere = (covering(overrides, start) ?? covering(standing, start))?.size;
    if (sizeHere === undefined) return;
    const last = merged.at(-1);
    if (last && last.size === sizeHere && last.end === start) last.end = end;
    else merged.push({ start, end, size: sizeHere });
  });
  const lastSegment = merged.at(-1);
  // Unbounded only when the standing rule has one size: a size the clock change swallowed this
  // week (an `off` inside the spring gap) still comes back.
  const forever =
    new Set(file.standing.map((rule) => rule.size)).size === 1 &&
    lastSegment !== undefined &&
    lastSegment.start <= wallInstant(addLocalDays(lastDate, -7), '00:00');
  return merged.map((segment) => ({
    ...segment,
    end: forever && segment === lastSegment ? null : segment.end,
  }));
}

type Resolved =
  | { kind: 'hold'; reason: string }
  | { kind: 'ready'; segments: ReturnType<typeof timeline>; current: ReturnType<typeof timeline>[number] };

function resolve(raw: unknown, now: Date): Resolved {
  const parsed = windowFileSchema.safeParse(raw);
  if (!parsed.success)
    return {
      kind: 'hold',
      reason: `The window file is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'file'} ${issue.message}`)
        .join('; ')}.`,
    };
  try {
    // A date more than a year ahead is a typo; resolving a timeline to it would take minutes a tick.
    const far = (parsed.data.exceptions ?? []).find(
      (exception) => exception.date > addLocalDays(formatBerlinLocalDate(now), 366),
    );
    if (far)
      return {
        kind: 'hold',
        reason: `The window file's exception on ${far.date} lies more than a year ahead.`,
      };
    const segments = timeline(parsed.data, now);
    const time = now.getTime();
    const current = segments.find(
      (segment) => segment.start <= time && (segment.end === null || time < segment.end),
    );
    if (!current)
      return { kind: 'hold', reason: `The window file covers no window at ${now.toISOString()}.` };
    return { kind: 'ready', segments, current };
  } catch (error) {
    return { kind: 'hold', reason: `The window file cannot be resolved: ${String(error)}` };
  }
}

/** The window at `now`: its size, or off, and the next instant that answer changes; a hold when the file cannot say. */
export function resolveWindow(file: unknown, now: Date): WindowAnswer {
  const resolved = resolve(file, now);
  if (resolved.kind === 'hold') return resolved;
  const { size: current, end } = resolved.current;
  const until = end === null ? null : new Date(end);
  return current === OFF ? { kind: 'off', until } : { kind: 'open', size: current, until };
}

/**
 * Whether a run of `expectedMs` plus `reserveMs` started now ends strictly before the window turns
 * off or changes size: the machine resizes only between runs, so a run never crosses a size change.
 * Refused, `retryAt` is the first instant such a run fits. `file` is the parsed window file; the
 * runner passes the raw text when it is no JSON, which holds.
 */
export function admitRun(
  file: unknown,
  now: Date,
  run: { expectedMs: number; reserveMs: number },
): Admission {
  const needMs = run.expectedMs + run.reserveMs;
  if (!Number.isFinite(needMs) || run.expectedMs < 0 || run.reserveMs < 0)
    throw new Error('A run needs a finite, non-negative expected time and reserve.');
  const resolved = resolve(file, now);
  if (resolved.kind === 'hold') return { admit: false, retryAt: null, reason: resolved.reason };
  const time = now.getTime();
  const fit = resolved.segments.find(
    (segment) =>
      segment.size !== OFF && (segment.end === null || Math.max(segment.start, time) + needMs < segment.end),
  );
  const minutes = Math.ceil(needMs / 60_000);
  if (fit && fit.start <= time) return { admit: true, size: fit.size };
  const current = resolved.current;
  const why =
    current.size === OFF
      ? 'The window is off'
      : `A ${minutes} min run would end after the ${current.size} window closes at ${new Date(current.end ?? time).toISOString()}`;
  return fit
    ? {
        admit: false,
        retryAt: new Date(fit.start),
        reason: `${why}; it fits from ${new Date(fit.start).toISOString()}.`,
      }
    : { admit: false, retryAt: null, reason: `${why}; no window ahead is ${minutes} min long.` };
}

/** The next instant the window turns off, from `now`; null when none lies ahead or the file holds. */
export function nextOffEdge(windowFile: unknown, now: number): number | null {
  let at = now;
  for (let step = 0; step < 64; step++) {
    const window = resolveWindow(windowFile, new Date(at));
    if (window.kind === 'off') return at;
    if (window.kind !== 'open' || window.until === null) return null;
    at = window.until.getTime();
  }
  return null;
}
