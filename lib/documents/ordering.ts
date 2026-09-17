/** Restore one deterministic order after independently ordered ID batches. */
export function newestDocumentsFirst<Row extends { id: string; created_at: string }>(rows: readonly Row[]): Row[] {
  return [...rows].sort((left, right) =>
    Date.parse(right.created_at) - Date.parse(left.created_at) ||
    left.id.localeCompare(right.id),
  );
}
