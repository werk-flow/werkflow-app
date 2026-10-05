import type { useBusyIds } from '@/hooks/use-busy-id';
import {
  deleteJobInstructionItem,
  reorderJobInstructionItems,
  reorderProjectInstructionItems,
  toggleJobInstructionItemCompletion,
} from '@/lib/jobs/instruction-items-actions';
import type {
  InstructionListOwner,
  JobInstructionActor,
  JobInstructionItemWithDetails,
} from '@/lib/jobs/types';
import { ERROR_MESSAGES, getJobInstructionErrorMessage } from './job-instruction-errors';
import type { JobInstructionItemList } from './use-job-instruction-item-list';

type JobInstructionRowActionsOptions = {
  owner: InstructionListOwner;
  currentUserActor: JobInstructionActor | null;
  itemList: JobInstructionItemList;
  busy: ReturnType<typeof useBusyIds>;
  showErrorBanner: (message: string) => void;
};

/**
 * Toggle, delete and reorder for one render of the card: the handlers close
 * over the rows of that render, so the card builds them on every render.
 */
export function createJobInstructionRowActions({
  owner,
  currentUserActor,
  itemList,
  busy,
  showErrorBanner,
}: JobInstructionRowActionsOptions) {
  const { items, setItems, replaceItem, syncItemsFromServer } = itemList;
  const { run: runOnRow, isBusy, anyBusy } = busy;

  async function handleToggleItem(item: JobInstructionItemWithDetails) {
    if (isBusy(item.id)) return;
    const optimisticTimestamp = new Date().toISOString();

    replaceItem({
      ...item,
      isCompleted: !item.isCompleted,
      lastStatusChangedAt: optimisticTimestamp,
      lastStatusChangedBy: currentUserActor?.userId ?? item.lastStatusChangedBy,
      lastStatusChangedByProfile: currentUserActor ?? item.lastStatusChangedByProfile,
      updatedAt: optimisticTimestamp,
    });

    // Optimistic flip: roll back to the previous row and surface the error
    // when the server rejects or the call throws.
    let errorMessage: string | null = null;
    try {
      const result = await runOnRow(item.id, () =>
        toggleJobInstructionItemCompletion({
          itemId: item.id,
          isCompleted: !item.isCompleted,
        }),
      );
      if (result.success) {
        replaceItem(result.item);
        return;
      }
      errorMessage = getJobInstructionErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.toggle_failed;
    }

    replaceItem(item);
    await syncItemsFromServer();
    showErrorBanner(errorMessage);
  }

  async function handleDeleteItem(item: JobInstructionItemWithDetails) {
    try {
      const result = await runOnRow(item.id, () => deleteJobInstructionItem({ itemId: item.id }));
      if (!result.success) {
        showErrorBanner(getJobInstructionErrorMessage(result.error));
        return;
      }
      setItems((currentItems) => currentItems.filter((entry) => entry.id !== item.id));
    } catch {
      showErrorBanner(ERROR_MESSAGES.delete_failed);
    }
  }

  async function handleMoveItem(itemId: string, direction: -1 | 1) {
    // A reorder sends the full id list, so it waits for any row mutation.
    if (anyBusy || items.some((item) => item.isOptimistic)) return;

    const currentIndex = items.findIndex((item) => item.id === itemId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) return;

    const currentItem = items[currentIndex];
    const neighbourItem = items[nextIndex];
    if (!currentItem || !neighbourItem) return;

    const previousItems = items;
    const nextItems = [...items];
    nextItems[currentIndex] = neighbourItem;
    nextItems[nextIndex] = currentItem;

    setItems(nextItems.map((item, index) => ({ ...item, sortOrder: index })));
    let errorMessage: string | null = null;
    try {
      const itemIds = nextItems.map((item) => item.id);
      const result = await runOnRow(itemId, () =>
        owner.projectId !== undefined
          ? reorderProjectInstructionItems({ projectId: owner.projectId, itemIds })
          : reorderJobInstructionItems({ jobId: owner.jobId, itemIds }),
      );
      if (result.success) {
        await syncItemsFromServer();
        return;
      }
      errorMessage = getJobInstructionErrorMessage(result.error);
    } catch {
      errorMessage = ERROR_MESSAGES.reorder_failed;
    }

    setItems(previousItems);
    await syncItemsFromServer();
    showErrorBanner(errorMessage);
  }

  const isReorderingDisabled = anyBusy || items.some((item) => item.isOptimistic);

  return {
    handleToggleItem,
    handleDeleteItem,
    handleMoveItem,
    isReorderingDisabled,
  };
}

export type JobInstructionRowActions = ReturnType<typeof createJobInstructionRowActions>;
