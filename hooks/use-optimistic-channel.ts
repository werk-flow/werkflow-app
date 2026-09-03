'use client';

import { useEffect } from 'react';

import type { useOptimisticList } from '@/hooks/use-optimistic-list';

/**
 * Bridge for the "create from a dialog" feedback rule when the dialog and
 * the list are siblings under a server component (the page header mounts
 * the dialog, the list streams in behind Suspense): the dialog announces the
 * draft and its outcome, the list applies them to its `useOptimisticList`.
 * Events with no subscriber are dropped, so the same dialog inside a select
 * (Aufträge, Anfragen) costs nothing.
 */
export type OptimisticCreateEvent<Item> =
  | { kind: 'insert'; tempId: string; draft: Item }
  | { kind: 'commit'; tempId: string; confirmed: Item }
  | { kind: 'rollback'; tempId: string };

export interface OptimisticChannel<Item> {
  publish: (event: OptimisticCreateEvent<Item>) => void;
  subscribe: (listener: (event: OptimisticCreateEvent<Item>) => void) => () => void;
}

export function createOptimisticChannel<Item>(): OptimisticChannel<Item> {
  const listeners = new Set<(event: OptimisticCreateEvent<Item>) => void>();
  return {
    publish(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type OptimisticListWriter<Item> = Pick<
  ReturnType<typeof useOptimisticList<Item>>,
  'insert' | 'commit' | 'rollback'
>;

/** Applies a channel's events to the list that owns the optimistic overlay. */
export function useOptimisticChannel<Item>(
  channel: OptimisticChannel<Item>,
  list: OptimisticListWriter<Item>
): void {
  const { insert, commit, rollback } = list;
  useEffect(
    () =>
      channel.subscribe((event) => {
        if (event.kind === 'insert') insert(event.tempId, event.draft);
        else if (event.kind === 'commit') commit(event.tempId, event.confirmed);
        else rollback(event.tempId);
      }),
    [channel, insert, commit, rollback]
  );
}
