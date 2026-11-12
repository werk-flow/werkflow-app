import type { FieldSyncTodayAssignment } from '@/lib/field-sync/today-snapshot';

// Which part of the stored day an address shows without signal (decision
// record 0010, "Device data"): a job page's address shows that job's pack,
// any other address the day's list.

/** The job number a job page's address names: `/auftraege/<nummer>` or `/auftraege/projekt/<projekt>/<nummer>`. */
function jobNumberOf(pathname: string): string | null {
  const match = /^\/auftraege\/(?:projekt\/[^/]+\/)?([^/]+)\/?$/.exec(pathname);
  if (!match?.[1] || match[1] === 'projekt' || match[1] === 'uebergaben') return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed address names no job; the day's list shows instead.
    return null;
  }
}

/**
 * The job number the address names, and the stored assignment whose pack it shows. Without an
 * assignment the day's list shows; a named job that is not stored gets a note above it.
 */
export function offlineViewAt(
  pathname: string,
  assignments: readonly FieldSyncTodayAssignment[],
): { jobNumber: string | null; assignment: FieldSyncTodayAssignment | null } {
  const jobNumber = jobNumberOf(pathname);
  // An assignment without a job number never matches an address that names no job.
  if (jobNumber === null) return { jobNumber, assignment: null };
  return { jobNumber, assignment: assignments.find((entry) => entry.jobNumber === jobNumber) ?? null };
}
