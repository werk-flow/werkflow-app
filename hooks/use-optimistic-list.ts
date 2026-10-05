'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { expireOptimisticOverlay, type OptimisticOverlayEntry } from '@/lib/ui/optimistic-overlay';

/**
 * Optimistic overlay for a list whose authority is server data (props from a
 * route refresh or a `useLiveView` read). The overlay holds inserts, updates,
 * and removes keyed by id; `items` is the merged view the surface renders.
 *
 * Contract:
 * - `insert` shows the draft immediately in its sorted position, flagged
 *   optimistic so the row renders dimmed; `commit(tempId, real)` swaps in the
 *   server row in place; `rollback(tempId)` removes it.
 * - `update` and `remove` snapshot the pre-image, so `rollback(id)` restores it.
 * - Self-expiry: an overlay entry drops the moment the server list contains
 *   its id (insert or update) or no longer contains it (remove). A route
 *   refresh or Realtime refetch landing first therefore reconciles by itself,
 *   which is what made the calendar's drag-and-drop override map safe.
 * - `settle(id)` after the server confirmed a mutation whose row the echo
 *   cannot predict completely (a server-set `updatedAt`, an insert that is
 *   never committed under its real id): the entry then leaves with the next
 *   authoritative list, so the caller starts that read and needs no manual
 *   rollback after it.
 * - Callers that own a `useLiveView` call `view.invalidate()` before applying
 *   an entry, per the live-view contract.
 */

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
  settle: (id: string) => void;
  isOptimistic: (id: string) => boolean;
  hasPending: boolean;
} {
  const [overlay, setOverlay] = useState<ReadonlyMap<string, OptimisticOverlayEntry<Item>>>(() => new Map());
  const getIdRef = useRef(getId);
  useEffect(() => {
    getIdRef.current = getId;
  });

  // Self-expiry against the authoritative list.
  useEffect(() => {
    setOverlay((current) => expireOptimisticOverlay(current, serverItems, getIdRef.current));
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
    [serverItems],
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
          existing?.kind === 'update'
            ? existing.previous
            : serverItems.find((item) => getIdRef.current(item) === id);
        if (previous === undefined) return current;
        return new Map(current).set(id, { kind: 'remove', previous });
      });
    },
    [serverItems],
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

  const settle = useCallback((id: string) => {
    setOverlay((current) => {
      const entry = current.get(id);
      if (!entry || entry.settled) return current;
      return new Map(current).set(id, { ...entry, settled: true });
    });
  }, []);

  const isOptimistic = useCallback((id: string) => overlay.has(id), [overlay]);

  return {
    items,
    insert,
    update,
    remove,
    commit,
    rollback,
    settle,
    isOptimistic,
    hasPending: overlay.size > 0,
  };
}
