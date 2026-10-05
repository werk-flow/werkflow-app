// Places a pending draft where the server row will land: both lists are
// ordered by name (inventory_items and, with equal sort_order, inventory_locations).
export function withPendingDraft<
  Row extends { id: string; name: string },
  Draft extends { name: string; confirmedId: string | null; id?: never },
>(rows: Row[], draft: Draft | null): Array<Row | Draft> {
  if (!draft || (draft.confirmedId && rows.some((row) => row.id === draft.confirmedId))) return rows;
  const index = rows.findIndex((row) => draft.name.localeCompare(row.name, 'de') <= 0);
  const position = index === -1 ? rows.length : index;
  return [...rows.slice(0, position), draft, ...rows.slice(position)];
}

export function isServerRow<
  Row extends { id: string },
  Draft extends { name: string; confirmedId: string | null; id?: never },
>(row: Row | Draft): row is Row {
  return 'id' in row;
}
