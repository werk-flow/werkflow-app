'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { expireOptimisticOverlay, type OptimisticOverlayEntry } from '@/lib/ui/optimistic-overlay';
import { markUnconfirmedLayer } from '@/lib/ui/unconfirmed';

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
 * - Unconfirmed marker (lib/ui/unconfirmed.ts): an entry stays `isOptimistic`
 *   until the authoritative list carries it, a committed insert included, and
 *   the surface passes that flag as `unconfirmed` to the row primitive. While
 *   any entry is held, `<html data-unconfirmed-layer>` is set, so a removal,
 *   which leaves no row to mark, keeps the settle step waiting too.
 */

export interface OptimisticListItem<Item> {
  item: Item;
  /** True while the row exists only in the overlay (not yet confirmed). */
  isOptimistic: boolean;
  /** The temporary id an insert was made under, until `commit` swaps it. */
  tempId: string | null;
}

/**
 * Self-expiry against the authoritative list, adopted during render with the
 * previous list tracked in state: an effect would cost a second commit and can
 * starve under hydration scheduling (realtime-and-caching.md, Checklist).
 */
function useOverlayExpiry<Item>(
  setOverlay: Dispatch<SetStateAction<ReadonlyMap<string, OptimisticOverlayEntry<Item>>>>,
  serverItems: readonly Item[],
  getId: (item: Item) => string,
): void {
  const [expiredAgainst, setExpiredAgainst] = useState(serverItems);
  if (serverItems === expiredAgainst) return;
  setExpiredAgainst(serverItems);
  // An updater, so an overlay change queued in the same batch is expired too, never overwritten.
  setOverlay((current) => expireOptimisticOverlay(current, serverItems, getId));
}

type OverlayMap<Item> = ReadonlyMap<string, OptimisticOverlayEntry<Item>>;

/** The server list with the overlay applied, inserts placed by `compare` or appended. */
function mergeOverlayItems<Item>(
  serverItems: readonly Item[],
  overlay: OverlayMap<Item>,
  getId: (item: Item) => string,
  compare: ((a: Item, b: Item) => number) | undefined,
): OptimisticListItem<Item>[] {
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
}

/** An update keeps the first pre-image, so a rollback restores the server row. */
function overlayWithUpdate<Item>(
  current: OverlayMap<Item>,
  id: string,
  next: Item,
  serverItems: readonly Item[],
  getId: (item: Item) => string,
): OverlayMap<Item> {
  const existing = current.get(id);
  const previous =
    existing?.kind === 'update' || existing?.kind === 'remove'
      ? existing.previous
      : serverItems.find((item) => getId(item) === id);
  if (previous === undefined) return current;
  return new Map(current).set(id, { kind: 'update', item: next, previous });
}

/** A removed insert simply leaves; any other row keeps its pre-image for a rollback. */
function overlayWithRemove<Item>(
  current: OverlayMap<Item>,
  id: string,
  serverItems: readonly Item[],
  getId: (item: Item) => string,
): OverlayMap<Item> {
  const existing = current.get(id);
  if (existing?.kind === 'insert') {
    const next = new Map(current);
    next.delete(id);
    return next;
  }
  const previous =
    existing?.kind === 'update' ? existing.previous : serverItems.find((item) => getId(item) === id);
  if (previous === undefined) return current;
  return new Map(current).set(id, { kind: 'remove', previous });
}

/** The overlay without the entry under `id`; the same map when it holds none. */
function overlayWithout<Item>(current: OverlayMap<Item>, id: string): OverlayMap<Item> {
  if (!current.has(id)) return current;
  const next = new Map(current);
  next.delete(id);
  return next;
}

/** The entry under `id` marked as confirmed by the server; the same map when there is nothing to mark. */
function overlayWithSettled<Item>(current: OverlayMap<Item>, id: string): OverlayMap<Item> {
  const entry = current.get(id);
  if (!entry || entry.settled) return current;
  return new Map(current).set(id, { ...entry, settled: true });
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
  // The updaters read the list of the latest commit, so their identity stays
  // stable across server lists and memoized rows keep their callbacks.
  const serverItemsRef = useRef(serverItems);
  useEffect(() => {
    getIdRef.current = getId;
    serverItemsRef.current = serverItems;
  });

  useOverlayExpiry(setOverlay, serverItems, getId);

  const hasPending = overlay.size > 0;
  useEffect(() => {
    if (!hasPending) return;
    const holder = Symbol('optimistic-list');
    markUnconfirmedLayer(holder, true);
    return () => markUnconfirmedLayer(holder, false);
  }, [hasPending]);

  const items = useMemo(
    () => mergeOverlayItems(serverItems, overlay, getId, compare),
    [serverItems, overlay, getId, compare],
  );

  const insert = useCallback((tempId: string, draft: Item) => {
    setOverlay((current) => new Map(current).set(tempId, { kind: 'insert', item: draft, tempId }));
  }, []);

  const update = useCallback((id: string, next: Item) => {
    setOverlay((current) => overlayWithUpdate(current, id, next, serverItemsRef.current, getIdRef.current));
  }, []);

  const remove = useCallback((id: string) => {
    setOverlay((current) => overlayWithRemove(current, id, serverItemsRef.current, getIdRef.current));
  }, []);

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
    setOverlay((current) => overlayWithout(current, id));
  }, []);

  const settle = useCallback((id: string) => {
    setOverlay((current) => overlayWithSettled(current, id));
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
    hasPending,
  };
}
