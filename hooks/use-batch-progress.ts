'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Determinate progress for an N-item operation (imports, batch reviews, bulk
 * moves), extracted from the document upload dialog's row state machine.
 * Items run sequentially, failures are isolated per item, and the aggregate
 * percentage is derived, never stored. Render `rows` for per-item status and
 * `progress` in a `role="progressbar"` element (feedback canon: determinate
 * work shows progress, never a bare spinner).
 */
export type BatchRowStatus = 'queued' | 'running' | 'done' | 'error';

export interface BatchRow<Item> {
  id: string;
  item: Item;
  status: BatchRowStatus;
  /** 0 to 100 within the item when the worker reports it. */
  progress: number;
  error: string | null;
}

export function useBatchProgress<Item>(): {
  rows: BatchRow<Item>[];
  isRunning: boolean;
  isComplete: boolean;
  /** 0 to 100 across all items. */
  progress: number;
  doneCount: number;
  failureCount: number;
  start: (
    items: ReadonlyArray<{ id: string; item: Item }>,
    worker: (item: Item, reportProgress: (percent: number) => void) => Promise<void>,
    errorMessage?: (error: unknown) => string
  ) => Promise<{ failures: number }>;
  reset: () => void;
} {
  const [rows, setRows] = useState<BatchRow<Item>[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<BatchRow<Item>>) => {
    if (!mountedRef.current) return;
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const start = useCallback(
    async (
      items: ReadonlyArray<{ id: string; item: Item }>,
      worker: (item: Item, reportProgress: (percent: number) => void) => Promise<void>,
      errorMessage: (error: unknown) => string = () => 'Der Schritt ist fehlgeschlagen.'
    ) => {
      setRows(items.map(({ id, item }) => ({ id, item, status: 'queued', progress: 0, error: null })));
      setIsRunning(true);
      let failures = 0;
      try {
        for (const { id, item } of items) {
          updateRow(id, { status: 'running' });
          try {
            await worker(item, (percent) =>
              updateRow(id, { progress: Math.max(0, Math.min(100, percent)) })
            );
            updateRow(id, { status: 'done', progress: 100 });
          } catch (error) {
            failures += 1;
            updateRow(id, { status: 'error', error: errorMessage(error) });
          }
        }
      } finally {
        if (mountedRef.current) setIsRunning(false);
      }
      return { failures };
    },
    [updateRow]
  );

  const reset = useCallback(() => {
    setRows([]);
    setIsRunning(false);
  }, []);

  const doneCount = rows.filter((row) => row.status === 'done').length;
  const failureCount = rows.filter((row) => row.status === 'error').length;
  const progress =
    rows.length === 0
      ? 0
      : Math.round(
          rows.reduce(
            (sum, row) => sum + (row.status === 'done' || row.status === 'error' ? 100 : row.progress),
            0
          ) / rows.length
        );
  const isComplete = rows.length > 0 && !isRunning && doneCount + failureCount === rows.length;

  return { rows, isRunning, isComplete, progress, doneCount, failureCount, start, reset };
}
