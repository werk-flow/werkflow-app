/**
 * Which Realtime events the clock-state provider must re-read for. The
 * state depends on the caller's own time rows and on exactly one job: the
 * job of the running session (`activeJobInfo`). Every other `jobs` change
 * (planning writes touch `jobs` on every occurrence save) was re-reading the
 * clock state on every open page and, because one client's Server Actions
 * run one after another, delayed the content reads behind it (Step 2,
 * PF-29, trace of run `2026-09-08T174800432Z-603147`).
 */
export type ClockStateEvent = {
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

export function isClockStateEventRelevant(
  event: ClockStateEvent,
  activeJobId: string | null
): boolean {
  if (event.table !== 'jobs') return true;
  const row = event.new ?? event.old;
  const rowId = row?.id;
  // A payload without an id is unknown territory: read rather than guess.
  if (rowId === undefined) return true;
  return activeJobId !== null && rowId === activeJobId;
}
