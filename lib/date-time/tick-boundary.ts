/**
 * The milliseconds from `nowMs` to the next whole multiple of `periodMs`
 * since the epoch: a minute tick lands when the clock's minute changes, so a
 * shown "now" never lags the wall clock by up to a minute.
 */
export function delayToNextTickBoundary(nowMs: number, periodMs: number): number {
  return periodMs - (nowMs % periodMs);
}
