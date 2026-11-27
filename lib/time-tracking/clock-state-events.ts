/**
 * Which Realtime events the clock-state provider must re-read for. The
 * state depends on the caller's own time rows and on exactly one job: the
 * job of the running session (`activeJobInfo`). Every other `jobs` change
 * (planning writes touch `jobs` on every occurrence save) would re-read the
 * clock state on every open page and, because one client's Server Actions
 * run one after another, delay the content reads behind it.
 */
export type ClockStateEvent = {
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

/**
 * Whether a time correction request's event can change the time of one of
 * `userIds`: its subject or its requester is one of them. A manager receives
 * every request of the organization, so a view of one person's time re-reads
 * only for that person's requests, in proportion to their pending work. A
 * payload that names neither (a deletion notice) is read, never guessed.
 * Events of every other table pass.
 */
export function isCorrectionEventFor(event: ClockStateEvent, userIds: readonly string[]): boolean {
  if (event.table !== 'time_correction_requests') return true;
  const row = event.new ?? event.old;
  const subject = row?.subject_user_id;
  const requester = row?.requested_by;
  if (subject === undefined && requester === undefined) return true;
  return userIds.some((userId) => userId === subject || userId === requester);
}

export function isClockStateEventRelevant(
  event: ClockStateEvent,
  activeJobId: string | null,
  viewerId: string | null,
): boolean {
  if (event.table === 'time_correction_requests')
    return isCorrectionEventFor(event, viewerId ? [viewerId] : []);
  if (event.table !== 'jobs') return true;
  const row = event.new ?? event.old;
  const rowId = row?.id;
  // A payload without an id is unknown territory: read rather than guess.
  if (rowId === undefined) return true;
  return activeJobId !== null && rowId === activeJobId;
}
