'use client';

import { useEffect, useRef, useState } from 'react';

import type { useBusyIds } from '@/hooks/use-busy-id';
import { updateJobInstructionItemContent } from '@/lib/jobs/instruction-items-actions';
import type { JobInstructionItemWithDetails } from '@/lib/jobs/types';
import { ERROR_MESSAGES, getJobInstructionErrorMessage } from './job-instruction-errors';
import { resizeTextareaElement } from './job-instruction-textarea';
import type { JobInstructionItemList } from './use-job-instruction-item-list';

type JobInstructionItemEditingOptions = {
  itemList: JobInstructionItemList;
  runOnRow: ReturnType<typeof useBusyIds>['run'];
  isBusy: ReturnType<typeof useBusyIds>['isBusy'];
  showErrorBanner: (message: string) => void;
};

/** Unsaved text edits of existing rows; a row saves on blur or Enter. */
export function useJobInstructionItemEditing({
  itemList,
  runOnRow,
  isBusy,
  showErrorBanner,
}: JobInstructionItemEditingOptions) {
  const { items, replaceItem, syncItemsFromServer } = itemList;
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const itemTextareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  useEffect(() => {
    for (const textarea of itemTextareaRefs.current.values()) {
      resizeTextareaElement(textarea);
    }
  }, [items, editingValues]);

  function clearEditingValue(itemId: string) {
    setEditingValues((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  // Never rejects: a failed or thrown save resets the row to the server
  // value and reports through the banner, so blur callers can drop the
  // returned flag.
  async function handleSaveExistingItem(item: JobInstructionItemWithDetails): Promise<boolean> {
    // Enter starts the save; the blur that follows must not send it again.
    if (isBusy(item.id)) return false;
    const nextValue = editingValues[item.id];
    if (nextValue === undefined || nextValue === item.content) {
      return true;
    }

    const trimmed = nextValue.trim();
    if (!trimmed) {
      clearEditingValue(item.id);
      showErrorBanner(ERROR_MESSAGES.content_required);
      return false;
    }

    let errorMessage: string | null = null;
    try {
      const result = await runOnRow(item.id, () =>
        updateJobInstructionItemContent({ itemId: item.id, content: nextValue }),
      );
      if (result.success) {
        replaceItem(result.item);
        clearEditingValue(item.id);
        return true;
      }
      errorMessage = getJobInstructionErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.update_failed;
    }

    await syncItemsFromServer();
    clearEditingValue(item.id);
    showErrorBanner(errorMessage);
    return false;
  }

  return {
    editingValues,
    setEditingValues,
    itemTextareaRefs,
    handleSaveExistingItem,
  };
}
