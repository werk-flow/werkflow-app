import type { LiveClockState } from '@/lib/time-tracking/types';
import type { ClockDeviceView } from './time-outbox';

// The rule of what the clock shows while the connection changes (shown-clock.ts holds it across
// renders; decision record 0010, the amendment "what the clock shows while the connection changes").

/** The calm marker beside the clock: why what it shows is not the server's answer yet. */
export type ClockMarker =
  /** Actions wait on the phone, and it has no network. */
  | 'waiting'
  /** Actions wait on the phone, or were just sent, and it has network: the server's answer is due. */
  | 'sending'
  /** Nothing waits, but the phone has no network: the clock shows the last state the server confirmed. */
  | 'offline'
  | null;

/** What the phone knows at one render. */
export type ClockFacts = {
  /** The clock the server last answered (a read, or this page's online answer), or null while unknown. */
  server: LiveClockState | null;
  /** When the read behind `server` started (`performance.now()`); an online answer counts at its arrival. */
  serverFrom: number;
  /**
   * When the last read that failed with network started; it ends a wait, and the failure shows. A
   * read that fails without network is no answer and never counts here.
   */
  failedFrom: number;
  /** What the outbox holds unsent for the person, once its code ran. */
  device: ClockDeviceView | null;
  /** When the outbox last answered (`performance.now()`). */
  deviceFrom: number;
  /** The clock with the actions this page kept and the outbox does not show yet, or null. */
  keptEcho: LiveClockState | null;
  /** The phone may hold unsent work that the outbox has not shown yet. */
  checkingDevice: boolean;
  online: boolean;
  /** The person and organization the clock is for; another one starts from nothing shown. */
  scope: string | null;
};

/** What the clock shows. */
export type ShownClock = {
  /** The clock shown, or null while nothing is sure yet. */
  state: LiveClockState | null;
  /** The unsent events the dock and the sheet show. */
  device: ClockDeviceView | null;
  marker: ClockMarker;
  /** Unsent actions settled, and the server's answer to them has not come yet: no action may start from the shown state. */
  settling: boolean;
};

/** The last shown clock and what it waits for. */
export type ShownMemory = {
  scope: string | null;
  shown: ShownClock;
  /** The phone showed actions the server has not answered. */
  local: boolean;
  /** When the phone's unsent actions settled; null when no answer is awaited. */
  settledAt: number | null;
};

/** Nothing shown yet: the memory a page starts with. */
export const NOTHING_SHOWN: ShownMemory = {
  scope: null,
  shown: { state: null, device: null, marker: null, settling: false },
  local: false,
  settledAt: null,
};

function sameShown(left: ShownClock, right: ShownClock): boolean {
  return (
    left.state === right.state &&
    left.device === right.device &&
    left.marker === right.marker &&
    left.settling === right.settling
  );
}

/**
 * The next shown clock. The phone's pending actions apply at once. When they settle (sent, or
 * stopped by the server), the shown clock stays until a clock read that started after that moment
 * answers, or fails; then the server's state and a stopped chain show together. Returns `memory`
 * itself when nothing changed.
 */
export function advanceShownClock(held: ShownMemory, facts: ClockFacts): ShownMemory {
  const { server, device, keptEcho, online, scope } = facts;
  // Another person or organization never sees the former one's clock, not even while it waits.
  const memory = held.scope === scope ? held : { ...NOTHING_SHOWN, scope };
  const local = device?.status === 'pending' || keptEcho !== null;
  let settledAt = local ? null : memory.local ? facts.deviceFrom : memory.settledAt;
  if (settledAt !== null && Math.max(facts.serverFrom, facts.failedFrom) >= settledAt) settledAt = null;
  const pending = online ? 'sending' : 'waiting';
  let shown: ShownClock;
  // This page's newest kept tap stands on the outbox's events, so it wins until the outbox shows it.
  if (local) shown = { state: keptEcho ?? device?.state ?? server, device, marker: pending, settling: false };
  else if (settledAt !== null) shown = { ...memory.shown, marker: pending, settling: true };
  else if (facts.checkingDevice) shown = NOTHING_SHOWN.shown;
  // A stopped chain shows the server's clock beside its own badge.
  else
    shown = {
      state: server,
      device,
      marker: online || device || !server ? null : 'offline',
      settling: false,
    };
  if (
    memory === held &&
    sameShown(shown, memory.shown) &&
    local === memory.local &&
    settledAt === memory.settledAt
  )
    return held;
  return { scope, shown: sameShown(shown, memory.shown) ? memory.shown : shown, local, settledAt };
}
