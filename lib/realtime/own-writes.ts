import { REALTIME_MAX_DEFER_MS, type RealtimeChangeEvent } from './events';
import { TRANSACTION_STAMPED_TABLES } from './tables';

/**
 * The echo of a person's own save (docs/technical/realtime-and-caching.md,
 * "Own-save echo"). A Server Action renders the route into its response after
 * its write committed, so the Realtime events of that write carry nothing the
 * new props lack. Every row a transaction writes in a stamped table shares
 * the transaction's start time as `updated_at`, so the stamps of the rows a
 * save returns name its transactions. A start time is no unique identity: two
 * transactions can start in one microsecond. An event is covered only when its
 * stamp is one the save returned and its row is one the save named (a row's
 * `id` or a reference such as `jobId`): a route refresh would render the same
 * data again. Any other event, a synthetic catch-up, and an event of an
 * unstamped table refresh as before. A stamp read during the save names a
 * transaction that committed even earlier, so recording every stamp of the
 * result is safe too.
 *
 * The echo can arrive before the save's response: the write commits first and
 * the response still renders the route. While a save of this tab runs, an
 * event of a stamped table waits and is judged once every running save
 * settled and recorded its result. The wait is bounded: a save holds events
 * only for `REALTIME_MAX_DEFER_MS` after it started, and a held event is
 * released after that time at the latest, so a slow save, a task that never
 * settles (`untilPageLeaves`) or a read run through the same hook delays
 * another writer's change by at most that time and never drops it.
 */

/** How long a recorded stamp covers its echo; the echo lands within about a second. */
const OWN_WRITE_STAMP_LIFETIME_MS = 60_000;
/** Bounds the walk over a save's result. */
const RESULT_WALK_DEPTH = 4;
const RESULT_WALK_VALUES = 500;

const STAMPED_TABLES: ReadonlySet<string> = new Set(TRANSACTION_STAMPED_TABLES);
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * A Postgres `timestamptz` text as epoch seconds and microseconds, so the
 * Realtime and the PostgREST spelling of one instant compare equal. Null for
 * anything else. The fraction is taken as written, so a value a client cut to
 * milliseconds never matches its database spelling.
 */
function transactionStamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', zone = 'Z'] = match;
  const offsetMinutes =
    zone === 'Z'
      ? 0
      : (zone.startsWith('-') ? -1 : 1) *
        (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(zone.includes(':') ? 4 : 3) || '0'));
  const epochSeconds =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) /
      1000 -
    offsetMinutes * 60;
  return `${epochSeconds}.${fraction.padEnd(6, '0')}`;
}

type SaveRecord = { stamps: Set<string>; rowIds: Set<string>; at: number };

function isRowReference(key: string): boolean {
  return key === 'id' || key.endsWith('Id') || key.endsWith('_id');
}

function collectSave(value: unknown, depth: number, save: SaveRecord, budget: { left: number }): void {
  if (depth > RESULT_WALK_DEPTH || budget.left <= 0 || value === null || typeof value !== 'object') return;
  budget.left -= 1;
  if (Array.isArray(value)) {
    for (const item of value) collectSave(item, depth + 1, save, budget);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'updatedAt' || key === 'updated_at') {
      const stamp = transactionStamp(entry);
      if (stamp) save.stamps.add(stamp);
    } else if (typeof entry === 'string' && isRowReference(key)) save.rowIds.add(entry);
    else collectSave(entry, depth + 1, save, budget);
  }
}

type OwnWriteRegistry = {
  /** Records the transaction stamps and row ids a save returned, and returns the result. */
  recorded: <Result>(result: Result, now?: number) => Result;
  /** Awaits a save, records its result and releases the events held while it ran. */
  track: <Result>(save: Promise<Result>) => Promise<Result>;
  /**
   * True when the event is held for a recent running save: `then` runs once the
   * running saves settled, after `REALTIME_MAX_DEFER_MS` at the latest. False
   * when no save started within that time or the event cannot be an echo.
   */
  heldForSave: (event: RealtimeChangeEvent, then: () => void) => boolean;
  /** True for a real event of a stamped table, of a row one save named, with a stamp that save returned. */
  covers: (event: RealtimeChangeEvent, now?: number) => boolean;
};

function createOwnWriteRegistry(): OwnWriteRegistry {
  let saves: SaveRecord[] = [];
  const runningSaves = new Set<{ startedAt: number }>();
  let held: Array<() => void> = [];
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const release = (): void => {
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = null;
    const waiting = held;
    held = [];
    for (const then of waiting) then();
  };
  // A save older than the bound holds nothing; dropping it keeps a task that never settles from piling up.
  const holding = (now: number): boolean => {
    for (const save of runningSaves)
      if (now - save.startedAt >= REALTIME_MAX_DEFER_MS) runningSaves.delete(save);
    return runningSaves.size > 0;
  };
  const recorded = <Result>(result: Result, now = Date.now()): Result => {
    const save: SaveRecord = { stamps: new Set(), rowIds: new Set(), at: now };
    collectSave(result, 0, save, { left: RESULT_WALK_VALUES });
    saves = saves.filter((earlier) => now - earlier.at <= OWN_WRITE_STAMP_LIFETIME_MS);
    if (save.stamps.size && save.rowIds.size) saves.push(save);
    return result;
  };
  return {
    recorded,
    track: async (save) => {
      const running = { startedAt: Date.now() };
      runningSaves.add(running);
      try {
        return recorded(await save);
      } finally {
        runningSaves.delete(running);
        if (!holding(Date.now())) release();
      }
    },
    heldForSave: (event, then) => {
      if (!event.new || !STAMPED_TABLES.has(event.table) || !holding(Date.now())) return false;
      held.push(then);
      releaseTimer ??= setTimeout(release, REALTIME_MAX_DEFER_MS);
      return true;
    },
    covers: (event, now = Date.now()) => {
      if (!event.new || !STAMPED_TABLES.has(event.table)) return false;
      const stamp = transactionStamp(event.new.updated_at);
      const rowId = event.new.id;
      if (!stamp || typeof rowId !== 'string') return false;
      return saves.some(
        (save) =>
          now - save.at <= OWN_WRITE_STAMP_LIFETIME_MS && save.stamps.has(stamp) && save.rowIds.has(rowId),
      );
    },
  };
}

/** This browser tab's own saves. */
export const ownWrites: OwnWriteRegistry = createOwnWriteRegistry();
