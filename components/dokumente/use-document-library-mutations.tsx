'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { deleteDocument, restoreDocument } from '@/lib/documents/actions';
import type { DocumentMutationResult, OrganizationDocument } from '@/lib/documents/types';

function getDocumentId(document: OrganizationDocument): string {
  return document.id;
}

export type DocumentLibraryMutations = ReturnType<typeof useDocumentLibraryMutations>;

/**
 * The document library's mutation core: the optimistic document list, the
 * per-row busy ids, the banner feedback and the trash/restore pair.
 *
 * Pending feedback (canon): trash/restore drop the row at once
 * through the optimistic overlay and roll back on failure; every other row
 * action marks its own row busy until the refreshed props land; the
 * move/copy dialog reports a determinate batch.
 */
export function useDocumentLibraryMutations(serverDocuments: OrganizationDocument[]) {
  const router = useRouter();
  const documentList = useOptimisticList({
    items: serverDocuments,
    getId: getDocumentId,
  });
  const documents = useMemo(() => documentList.items.map((entry) => entry.item), [documentList.items]);
  const busy = useBusyIds();
  const waitForDocuments = useSettleOnChange(serverDocuments);
  const [activeDocumentMutationCount, setActiveDocumentMutationCount] = useState(0);
  const hasPendingDocumentMutation = activeDocumentMutationCount > 0;
  const { showBanner } = useBanner();

  function showFeedback(variant: 'success' | 'error', message: string) {
    showBanner({ variant, message });
  }

  function showUndoBanner(message: string, onUndo: () => Promise<void>) {
    showBanner({
      variant: 'success',
      message,
      actionLabel: 'Rückgängig',
      actionIcon: <Undo2 className="size-3.5" />,
      onAction: () => {
        void onUndo().catch(() =>
          showFeedback('error', 'Die Aktion konnte nicht rückgängig gemacht werden.'),
        );
      },
    });
  }

  function refreshDocuments() {
    router.refresh();
  }

  /** Runs one mutation under the row's busy id; a thrown action counts as a failure. */
  function runMutation(id: string, mutation: () => Promise<{ success: boolean }>): Promise<boolean> {
    return busy
      .run(id, mutation)
      .then((result) => result.success)
      .catch(() => false);
  }

  async function settleAfterRefresh() {
    refreshDocuments();
    await waitForDocuments();
  }

  async function runDocumentMutationFlow<Result>(mutation: () => Promise<Result>): Promise<Result> {
    setActiveDocumentMutationCount((current) => current + 1);
    try {
      return await mutation();
    } finally {
      setActiveDocumentMutationCount((current) => Math.max(0, current - 1));
    }
  }

  // Drops the rows at once, runs the mutation per document, and restores the
  // rows whose mutation failed. Used for trash and restore in both directions.
  async function mutateDocuments(
    documentsToMutate: OrganizationDocument[],
    mutation: (documentId: string) => Promise<DocumentMutationResult>,
  ): Promise<{ failedCount: number }> {
    for (const document of documentsToMutate) {
      documentList.remove(document.id);
    }
    let failedCount = 0;
    for (const document of documentsToMutate) {
      const succeeded = await runMutation(document.id, () => mutation(document.id));
      if (succeeded) continue;
      failedCount++;
      documentList.rollback(document.id);
    }
    return { failedCount };
  }

  async function trashDocuments(documentsToTrash: OrganizationDocument[]) {
    return runDocumentMutationFlow(async () => {
      const total = documentsToTrash.length;
      const { failedCount } = await mutateDocuments(documentsToTrash, deleteDocument);
      if (failedCount > 0) {
        showFeedback(
          'error',
          total === 1
            ? 'Die Datei konnte nicht gelöscht werden.'
            : `${failedCount} von ${total} Dateien konnten nicht gelöscht werden.`,
        );
      } else {
        showUndoBanner(
          total === 1
            ? 'Datei wurde in den Papierkorb verschoben.'
            : `${total} Dateien wurden in den Papierkorb verschoben.`,
          () => restoreDocuments(documentsToTrash),
        );
      }
      if (failedCount < total) await settleAfterRefresh();
    });
  }

  async function restoreDocuments(documentsToRestore: OrganizationDocument[]) {
    return runDocumentMutationFlow(async () => {
      const total = documentsToRestore.length;
      const { failedCount } = await mutateDocuments(documentsToRestore, restoreDocument);
      if (failedCount > 0) {
        showFeedback(
          'error',
          total === 1
            ? 'Die Datei konnte nicht wiederhergestellt werden.'
            : `${failedCount} von ${total} Dateien konnten nicht wiederhergestellt werden.`,
        );
      } else {
        showUndoBanner(
          total === 1 ? 'Datei wurde wiederhergestellt.' : `${total} Dateien wurden wiederhergestellt.`,
          () => trashDocuments(documentsToRestore),
        );
      }
      if (failedCount < total) await settleAfterRefresh();
    });
  }

  return {
    documents,
    documentList,
    busy,
    hasPendingDocumentMutation,
    showFeedback,
    refreshDocuments,
    runMutation,
    settleAfterRefresh,
    runDocumentMutationFlow,
    mutateDocuments,
    trashDocuments,
    restoreDocuments,
  };
}
