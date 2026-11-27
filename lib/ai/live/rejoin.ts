// When a tab joins its thread's live channel again after the join failed
// (werk-flow/werkflow-planning#532, brief non-negotiable 7): it backs off with
// jitter, and one short success does not reset the backoff, so a channel that
// drops right after each join is not joined again at full speed.

const REJOIN_FIRST_MS = 1_000;
const REJOIN_CAP_MS = 30_000;
/** A join that held this long counts as recovered: its failure starts the backoff from the beginning. */
const KI_LIVE_STABLE_MS = 60_000;

/** The failures in a row after the join that just failed; `heldMs` is how long it held, null when it never joined. */
export function kiLiveFailures(previous: number, heldMs: number | null): number {
  return (heldMs !== null && heldMs >= KI_LIVE_STABLE_MS ? 0 : previous) + 1;
}

/**
 * The wait before the next join: the ceiling doubles with each failure up to
 * 30 s, and the wait lies between half the ceiling and the ceiling (`random`
 * in [0, 1)), so tabs that lost the connection together come back apart.
 */
export function kiLiveRejoinDelayMs(failures: number, random: number): number {
  const ceiling = Math.min(REJOIN_CAP_MS, REJOIN_FIRST_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(ceiling / 2 + (random * ceiling) / 2);
}
