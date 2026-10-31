'use client';

import { useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import type { ActionResult } from '@/lib/action-result';
import { deleteDocument, restoreDocument } from '@/lib/documents/library-actions';
import type { DocumentMutationResult, OrganizationDocument } from '@/lib/documents/types';

function getDocumentId(document: OrganizationDocument): string {
  return document.id;
}

export type DocumentLibraryMutations = ReturnType<typeof useDocumentLibraryMutations>;

/** The banner sentences of one undoable batch direction. */
type UndoableBatchSentences = {
  failure: (failedCount: number, total: number) => string;
  success: (total: number) => string;
};

const TRASH_SENTENCES: UndoableBatchSentences = {
  failure: (failedCount, total) =>
    total === 1
      ? 'Die Datei konnte nicht gelöscht werden.'
      : `${failedCount} von ${total} Dateien konnten nicht gelöscht werden.`,
  success: (total) =>
    total === 1
      ? 'Datei wurde in den Papierkorb verschoben.'
      : `${total} Dateien wurden in den Papierkorb verschoben.`,
};

const RESTORE_SENTENCES: UndoableBatchSentences = {
  failure: (failedCount, total) =>
    total === 1
      ? 'Die Datei konnte nicht wiederhergestellt werden.'
      : `${failedCount} von ${total} Dateien konnten nicht wiederhergestellt werden.`,
  success: (total) =>
    total === 1 ? 'Datei wurde wiederhergestellt.' : `${total} Dateien wurden wiederhergestellt.`,
};

/** Counts the running document flows, so the library knows one is pending. */
function useDocumentMutationFlow() {
  const [activeDocumentMutationCount, setActiveDocumentMutationCount] = useState(0);
  const hasPendingDocumentMutation = activeDocumentMutationCount > 0;

  async function runDocumentMutationFlow<Result>(mutation: () => Promise<Result>): Promise<Result> {
    setActiveDocumentMutationCount((current) => current + 1);
    try {
      return await mutation();
    } finally {
      setActiveDocumentMutationCount((current) => Math.max(0, current - 1));
    }
  }

  return { hasPendingDocumentMutation, runDocumentMutationFlow };
}

/** The library's banner feedback: a plain message, or a success with „Rückgängig". */
function useDocumentLibraryFeedback() {
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

  return { showFeedback, showUndoBanner };
}

/**
 * The document library's mutation core: the optimistic document list, the
 * per-row busy ids, the banner feedback and the trash/restore pair.
 *
 * Pending feedback (canon): trash/restore drop the row at once
 * through the optimistic overlay and roll back on failure; every other row
 * action marks its own row busy until the refreshed props land; the
 * move/copy dialog reports a determinate batch.
 *
 * Every document action revalidates (`revalidateDocuments`), so its response
 * renders the route: no client refresh follows a save. `waitForDocuments`
 * resolves when those props land; a batch waits from a mark taken before its
 * first action.
 */
export function useDocumentLibraryMutations(serverDocuments: OrganizationDocument[]) {
  const documentList = useOptimisticList({
    items: serverDocuments,
    getId: getDocumentId,
  });
  const documents = useMemo(() => documentList.items.map((entry) => entry.item), [documentList.items]);
  const busy = useBusyIds();
  const waitForDocuments = useSettleOnChange(serverDocuments);
  const { hasPendingDocumentMutation, runDocumentMutationFlow } = useDocumentMutationFlow();
  const { showFeedback, showUndoBanner } = useDocumentLibraryFeedback();

  /** Runs one mutation under the row's busy id; a thrown action counts as a failure. */
  function runMutation(id: string, mutation: () => Promise<ActionResult>): Promise<boolean> {
    return busy
      .run(id, mutation)
      .then((result) => result.success)
      .catch(() => false);
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

  // Trash and restore undo each other through the success banner.
  function runUndoableBatch(
    documentsToMutate: OrganizationDocument[],
    mutation: (documentId: string) => Promise<DocumentMutationResult>,
    sentences: UndoableBatchSentences,
    undo: () => Promise<void>,
  ): Promise<void> {
    return runDocumentMutationFlow(async () => {
      const total = documentsToMutate.length;
      const since = waitForDocuments.markChange();
      const { failedCount } = await mutateDocuments(documentsToMutate, mutation);
      if (failedCount > 0) {
        showFeedback('error', sentences.failure(failedCount, total));
      } else {
        showUndoBanner(sentences.success(total), undo);
      }
      if (failedCount < total) await waitForDocuments(since);
    });
  }

  async function trashDocuments(documentsToTrash: OrganizationDocument[]): Promise<void> {
    return runUndoableBatch(documentsToTrash, deleteDocument, TRASH_SENTENCES, () =>
      restoreDocuments(documentsToTrash),
    );
  }

  async function restoreDocuments(documentsToRestore: OrganizationDocument[]): Promise<void> {
    return runUndoableBatch(documentsToRestore, restoreDocument, RESTORE_SENTENCES, () =>
      trashDocuments(documentsToRestore),
    );
  }

  return {
    documents,
    documentList,
    busy,
    hasPendingDocumentMutation,
    showFeedback,
    runMutation,
    waitForDocuments,
    runDocumentMutationFlow,
    mutateDocuments,
    trashDocuments,
    restoreDocuments,
  };
}
