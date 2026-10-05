'use client';

import { useEffect, useState } from 'react';

import { getJobInstructionItems, getProjectInstructionItems } from '@/lib/jobs/instruction-items-actions';
import type { InstructionListOwner, JobInstructionItemWithDetails } from '@/lib/jobs/types';

export type RenderedInstructionItem = JobInstructionItemWithDetails & {
  isOptimistic?: boolean;
};

type JobInstructionItemListOptions = {
  owner: InstructionListOwner;
  initialItems: JobInstructionItemWithDetails[];
  refreshSignal: number;
};

/** The rendered instruction rows and their reconciliation with the server. */
export function useJobInstructionItemList({
  owner,
  initialItems,
  refreshSignal,
}: JobInstructionItemListOptions) {
  const [items, setItems] = useState<RenderedInstructionItem[]>(initialItems);

  // A new server list replaces the rows during render, never in an effect. A
  // mount effect inside a hydrated Suspense boundary runs at idle priority;
  // its update starved behind a route transition, React rebased the later
  // copy on every render into a new array, and the page committed forever.
  const [renderedInitialItems, setRenderedInitialItems] = useState(initialItems);
  if (initialItems !== renderedInitialItems) {
    setRenderedInitialItems(initialItems);
    // A route refresh during a create keeps that create's optimistic row.
    setItems((currentItems) => [...initialItems, ...currentItems.filter((item) => item.isOptimistic)]);
  }

  useEffect(() => {
    if (owner.projectId) void syncItemsFromServer();
    // The project detail route does not preload these rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncItemsFromServer reads the current project; it runs once per project or refresh signal
  }, [owner.projectId, refreshSignal]);

  /** Never throws: a failed refresh keeps the rows, and the caller's own feedback still runs. */
  async function syncItemsFromServer(): Promise<void> {
    const result = await (
      owner.projectId !== undefined
        ? getProjectInstructionItems(owner.projectId)
        : getJobInstructionItems(owner.jobId)
    ).catch(() => null);
    if (!result?.success) return;

    // A create still in flight keeps its optimistic row, so its success can
    // replace that row; the read never contains the row's temporary id.
    setItems((currentItems) => [...result.items, ...currentItems.filter((item) => item.isOptimistic)]);
  }

  function replaceItem(nextItem: JobInstructionItemWithDetails) {
    setItems((currentItems) => currentItems.map((item) => (item.id === nextItem.id ? nextItem : item)));
  }

  function appendItem(nextItem: JobInstructionItemWithDetails) {
    setItems((currentItems) => [...currentItems, nextItem]);
  }

  return { items, setItems, syncItemsFromServer, replaceItem, appendItem };
}

export type JobInstructionItemList = ReturnType<typeof useJobInstructionItemList>;
