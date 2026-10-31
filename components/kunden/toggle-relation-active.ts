import type { ActionResult } from '@/lib/action-result';

import { clientRelationErrorMessage } from './client-relation-drafts';
import type { RelationRowTasks } from './use-relation-row-tasks';

interface RelationActiveToggle<Row> {
  list: {
    update: (id: string, next: Row) => void;
    rollback: (id: string) => void;
    settle: (id: string) => void;
  };
  rowTasks: RelationRowTasks;
  waitForRows: () => Promise<void>;
  setSectionError: (error: string | null) => void;
  saveIsActive: (id: string, isActive: boolean) => Promise<ActionResult>;
}

/**
 * Archives or restores a contact or a site: the row moves at once, a refusal
 * restores it with the reason, and a success settles once the refreshed props
 * confirm it.
 */
export function toggleRelationActive<Row extends { id: string; isActive: boolean }>(
  row: Row,
  { list, rowTasks, waitForRows, setSectionError, saveIsActive }: RelationActiveToggle<Row>,
): void {
  setSectionError(null);
  list.update(row.id, { ...row, isActive: !row.isActive });
  void rowTasks.runRowTask(row.id, async () => {
    const result = await saveIsActive(row.id, !row.isActive).catch(() => ({
      success: false as const,
      error: 'unexpected_error',
    }));
    if (!result.success) {
      list.rollback(row.id);
      setSectionError(clientRelationErrorMessage(result.error));
      return;
    }
    await rowTasks.settleRow(list, row.id, waitForRows);
  });
}
