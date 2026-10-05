'use client';

import { useRouter } from 'next/navigation';

import { useBusyIds } from '@/hooks/use-busy-id';

export interface RelationRowTasks {
  runRowTask: <Result>(id: string, task: () => Promise<Result>) => Promise<Result>;
  isBusy: (id: string) => boolean;
  /** Reads the route again and hands the row back to the refreshed props. */
  settleRow: (
    list: { settle: (id: string) => void },
    id: string,
    waitForRows: () => Promise<void>,
  ) => Promise<void>;
}

// A save or an archive shows in the list at once and marks only its own
// row until the refreshed props confirm it; a refusal restores the row.
export function useRelationRowTasks(): RelationRowTasks {
  const router = useRouter();
  const { run: runRowTask, isBusy } = useBusyIds();

  function settleRow(
    list: { settle: (id: string) => void },
    id: string,
    waitForRows: () => Promise<void>,
  ): Promise<void> {
    list.settle(id);
    router.refresh();
    return runRowTask(id, waitForRows);
  }

  return { runRowTask, isBusy, settleRow };
}
