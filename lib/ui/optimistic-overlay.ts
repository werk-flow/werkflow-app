/**
 * The pending entries of an optimistic list (`hooks/use-optimistic-list.ts`),
 * keyed by row id. `settled` marks an entry whose mutation the server already
 * confirmed: it only waits for the next authoritative list.
 */
export type OptimisticOverlayEntry<Item> = (
  | { kind: 'insert'; item: Item; tempId: string }
  | { kind: 'update'; item: Item; previous: Item }
  | { kind: 'remove'; previous: Item }
) & { settled?: true };

/**
 * The overlay after a new authoritative list arrived. An entry leaves when
 * the list carries its change: an insert whose id is listed, an update whose
 * every field matches, a remove whose id is gone. A settled entry leaves in
 * any case, because the server row may carry fields the echo cannot predict
 * (`updatedAt`, a generated id). Returns the same map when nothing expired.
 */
export function expireOptimisticOverlay<Item>(
  overlay: ReadonlyMap<string, OptimisticOverlayEntry<Item>>,
  serverItems: readonly Item[],
  getId: (item: Item) => string,
): ReadonlyMap<string, OptimisticOverlayEntry<Item>> {
  if (overlay.size === 0) return overlay;
  const serverById = new Map(serverItems.map((item) => [getId(item), item]));
  const remaining = new Map(overlay);
  for (const [id, entry] of overlay) {
    const serverItem = serverById.get(id);
    const confirmed =
      entry.settled ||
      (entry.kind === 'insert' && serverItem !== undefined) ||
      (entry.kind === 'update' && serverItem !== undefined && carriesEveryField(serverItem, entry.item)) ||
      (entry.kind === 'remove' && serverItem === undefined);
    if (confirmed) remaining.delete(id);
  }
  return remaining.size === overlay.size ? overlay : remaining;
}

function carriesEveryField<Item>(serverItem: Item, echo: Item): boolean {
  return Object.entries(echo as Record<string, unknown>).every(
    ([key, value]) => (serverItem as Record<string, unknown>)[key] === value,
  );
}
