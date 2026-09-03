'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Optimistic overlay for a list whose authority is server data (props from a
 * route refresh or a `useLiveView` read). The overlay holds inserts, updates,
 * and removes keyed by id; `items` is the merged view the surface renders.
 *
 * Contract (feedback canon, 2026-09-03):
 * - `insert` shows the draft immediately in its sorted position, flagged
 *   optimistic so the row renders dimmed; `commit(tempId, real)` swaps in the
 *   server row in place; `rollback(tempId)` removes it.
 * - `update` and `remove` snapshot the pre-image, so `rollback(id)` restores it.
 * - Self-expiry: an overlay entry drops the moment the server list contains
 *   its id (insert or update) or no longer contains it (remove). A route
 *   refresh or Realtime refetch landing first therefore reconciles by itself,
 *   which is what made the calendar's drag-and-drop override map safe.
 * - Callers that own a `useLiveView` call `view.invalidate()` before applying
 *   an entry, per the live-view contract.
 */

type Overlay<Item> =
  | { kind: 'insert'; item: Item; tempId: string }
  | { kind: 'update'; item: Item; previous: Item }
  | { kind: 'remove'; previous: Item };

export interface OptimisticListItem<Item> {
  item: Item;
  /** True while the row exists only in the overlay (not yet confirmed). */
  isOptimistic: boolean;
  /** The temporary id an insert was made under, until `commit` swaps it. */
  tempId: string | null;
}

export function useOptimisticList<Item>({
  items: serverItems,
  getId,
  compare,
}: {
  items: readonly Item[];
  getId: (item: Item) => string;
  /** The list's own sort, so a placeholder lands where the real row will. Appends when omitted. */
  compare?: (a: Item, b: Item) => number;
}): {
  items: OptimisticListItem<Item>[];
  insert: (tempId: string, draft: Item) => void;
  update: (id: string, next: Item) => void;
  remove: (id: string) => void;
  commit: (tempId: string, confirmed: Item) => void;
  rollback: (id: string) => void;
  isOptimistic: (id: string) => boolean;
  hasPending: boolean;
} {
  const [overlay, setOverlay] = useState<Map<string, Overlay<Item>>>(() => new Map());
  const getIdRef = useRef(getId);
  useEffect(() => {
    getIdRef.current = getId;
  });

  // Self-expiry against the authoritative list.
  useEffect(() => {
    setOverlay((current) => {
      if (current.size === 0) return current;
      const serverIds = new Set(serverItems.map((item) => getIdRef.current(item)));
      let changed = false;
      const next = new Map(current);
      for (const [id, entry] of current) {
        const confirmedByServer =
          (entry.kind === 'insert' && serverIds.has(id)) ||
          (entry.kind === 'update' && serverIds.has(id) && entryMatchesServer(entry, serverItems, getIdRef.current)) ||
          (entry.kind === 'remove' && !serverIds.has(id));
        if (confirmedByServer) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [serverItems]);

  const items = useMemo(() => {
    const merged: OptimisticListItem<Item>[] = [];
    for (const item of serverItems) {
      const id = getId(item);
      const entry = overlay.get(id);
      if (entry?.kind === 'remove') continue;
      if (entry?.kind === 'update') {
        merged.push({ item: entry.item, isOptimistic: true, tempId: null });
        continue;
      }
      merged.push({ item, isOptimistic: false, tempId: null });
    }
    for (const [id, entry] of overlay) {
      if (entry.kind !== 'insert') continue;
      if (serverItems.some((item) => getId(item) === id)) continue;
      merged.push({ item: entry.item, isOptimistic: true, tempId: entry.tempId });
    }
    if (compare) merged.sort((a, b) => compare(a.item, b.item));
    return merged;
  }, [serverItems, overlay, getId, compare]);

  const insert = useCallback((tempId: string, draft: Item) => {
    setOverlay((current) => new Map(current).set(tempId, { kind: 'insert', item: draft, tempId }));
  }, []);

  const update = useCallback(
    (id: string, next: Item) => {
      setOverlay((current) => {
        const existing = current.get(id);
        const previous =
          existing?.kind === 'update' || existing?.kind === 'remove'
            ? existing.previous
            : serverItems.find((item) => getIdRef.current(item) === id);
        if (previous === undefined) return current;
        return new Map(current).set(id, { kind: 'update', item: next, previous });
      });
    },
    [serverItems]
  );

  const remove = useCallback(
    (id: string) => {
      setOverlay((current) => {
        const existing = current.get(id);
        if (existing?.kind === 'insert') {
          const next = new Map(current);
          next.delete(id);
          return next;
        }
        const previous =
          existing?.kind === 'update' ? existing.previous : serverItems.find((item) => getIdRef.current(item) === id);
        if (previous === undefined) return current;
        return new Map(current).set(id, { kind: 'remove', previous });
      });
    },
    [serverItems]
  );

  const commit = useCallback((tempId: string, confirmed: Item) => {
    setOverlay((current) => {
      const next = new Map(current);
      next.delete(tempId);
      // Keep the confirmed row visible until the server list carries it.
      next.set(getIdRef.current(confirmed), { kind: 'insert', item: confirmed, tempId });
      return next;
    });
  }, []);

  const rollback = useCallback((id: string) => {
    setOverlay((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const isOptimistic = useCallback((id: string) => overlay.has(id), [overlay]);

  return { items, insert, update, remove, commit, rollback, isOptimistic, hasPending: overlay.size > 0 };
}

function entryMatchesServer<Item>(
  entry: { kind: 'update'; item: Item },
  serverItems: readonly Item[],
  getId: (item: Item) => string
): boolean {
  const id = getId(entry.item);
  const serverItem = serverItems.find((item) => getId(item) === id);
  if (serverItem === undefined) return false;
  // Shallow field comparison: the server row is authoritative once every
  // field the optimistic update set matches it.
  return Object.entries(entry.item as Record<string, unknown>).every(
    ([key, value]) => (serverItem as Record<string, unknown>)[key] === value
  );
}
