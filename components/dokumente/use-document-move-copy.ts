'use client';

import { useState } from 'react';

import { useBatchProgress } from '@/hooks/use-batch-progress';
import { copyDocument, copyDocumentFolder, moveDocument, moveDocumentFolder } from '@/lib/documents/actions';
import type { DocumentFolder, DocumentLibraryView, OrganizationDocument } from '@/lib/documents/types';
import {
  getSharedSourceFolderId,
  getTopLevelSelectedFolders,
  targetContainsSelectedFolder,
  targetContainsSelectedItemCurrentLocation,
} from '@/lib/documents/folder-tree';
import type { DocumentLibraryMutations } from './use-document-library-mutations';
import type { DocumentLibrarySelection } from './use-document-library-selection';

type MoveCopyMode = 'move' | 'copy';

type MoveCopyDialogState = {
  mode: MoveCopyMode;
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
  sourceFolderId: string | null;
} | null;

/** One step of a client-iterated bulk operation; a failed result throws so the batch counts it. */
type BulkStep = () => Promise<{ success: boolean }>;

export type DocumentMoveCopyItem =
  | { kind: 'document'; document: OrganizationDocument }
  | { kind: 'folder'; folder: DocumentFolder };

function buildMoveCopySteps({
  mode,
  documentsToProcess,
  topLevelFoldersToProcess,
  destinationFolderId,
}: {
  mode: MoveCopyMode;
  documentsToProcess: OrganizationDocument[];
  topLevelFoldersToProcess: DocumentFolder[];
  destinationFolderId: string | null;
}): Array<{ id: string; item: BulkStep }> {
  return [
    ...documentsToProcess.map((document) => ({
      id: document.id,
      item: () =>
        mode === 'move'
          ? moveDocument({
              documentId: document.id,
              folderId: destinationFolderId,
            })
          : copyDocument({
              documentId: document.id,
              targetFolderId: destinationFolderId,
            }),
    })),
    ...topLevelFoldersToProcess.map((folder) => ({
      id: folder.id,
      item: () =>
        mode === 'move'
          ? moveDocumentFolder({
              folderId: folder.id,
              parentFolderId: destinationFolderId,
            })
          : copyDocumentFolder({
              folderId: folder.id,
              targetParentFolderId: destinationFolderId,
            }),
    })),
  ];
}

/** The reason a destination is not allowed for these items, or null when it is. */
function getMoveCopyDestinationError({
  mode,
  allFolders,
  documentsToProcess,
  foldersToProcess,
  destinationFolderId,
}: {
  mode: MoveCopyMode;
  allFolders: DocumentFolder[];
  documentsToProcess: OrganizationDocument[];
  foldersToProcess: DocumentFolder[];
  destinationFolderId: string | null;
}): string | null {
  if (
    targetContainsSelectedFolder({
      allFolders,
      foldersToProcess,
      destinationFolderId,
    })
  ) {
    return mode === 'copy'
      ? 'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner kopiert werden.'
      : 'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner verschoben werden.';
  }

  if (
    mode === 'move' &&
    targetContainsSelectedItemCurrentLocation({
      documentsToProcess,
      foldersToProcess,
      destinationFolderId,
    })
  ) {
    return 'Einträge können nicht in ihren aktuellen Ordner verschoben werden.';
  }

  return null;
}

export type DocumentMoveCopy = ReturnType<typeof useDocumentMoveCopy>;

/**
 * The move/copy dialog of the library: which items it holds, the validation of
 * the chosen destination, and the batch that moves or copies them.
 */
export function useDocumentMoveCopy({
  allFolders,
  currentFolderId,
  visibleView,
  isTrashView,
  mutations,
  selection,
}: {
  allFolders: DocumentFolder[];
  currentFolderId: string | null;
  visibleView: DocumentLibraryView;
  isTrashView: boolean;
  mutations: DocumentLibraryMutations;
  selection: DocumentLibrarySelection;
}) {
  const { documentList, showFeedback } = mutations;
  const { selectedDocuments, selectedFolders, selectedItemCount } = selection;
  const moveCopyBatch = useBatchProgress<BulkStep>();
  const [moveCopyError, setMoveCopyError] = useState<string | null>(null);
  const [moveCopyDialog, setMoveCopyDialog] = useState<MoveCopyDialogState>(null);

  async function runMoveCopyOperation({
    mode,
    documentsToProcess,
    foldersToProcess,
    destinationFolderId,
    onSuccess,
  }: {
    mode: MoveCopyMode;
    documentsToProcess: OrganizationDocument[];
    foldersToProcess: DocumentFolder[];
    destinationFolderId: string | null;
    onSuccess: () => void;
  }) {
    if (moveCopyBatch.isRunning) return;

    const itemCount = documentsToProcess.length + foldersToProcess.length;
    if (itemCount === 0) return;

    // Validation and failures render inside the destination dialog, which
    // stays open until the batch succeeds.
    const destinationError = getMoveCopyDestinationError({
      mode,
      allFolders,
      documentsToProcess,
      foldersToProcess,
      destinationFolderId,
    });
    if (destinationError) {
      setMoveCopyError(destinationError);
      return;
    }

    const topLevelFoldersToProcess = getTopLevelSelectedFolders(foldersToProcess, allFolders);
    const actionLabel = mode === 'copy' ? 'kopiert' : 'verschoben';
    setMoveCopyError(null);

    const succeededIds = new Set<string>();
    const steps = buildMoveCopySteps({
      mode,
      documentsToProcess,
      topLevelFoldersToProcess,
      destinationFolderId,
    }).map(({ id, item }) => ({
      id,
      item: async () => {
        const result = await item();
        if (result.success) succeededIds.add(id);
        return result;
      },
    }));

    const { failures } = await moveCopyBatch.start(steps, async (perform) => {
      const result = await perform();
      if (!result.success) throw new Error('bulk_step_failed');
    });

    if (failures > 0) {
      const failedItemLabel = failures === 1 ? '1 Eintrag' : `${failures} Einträge`;
      setMoveCopyError(
        `${failedItemLabel} ${failures === 1 ? 'konnte' : 'konnten'} nicht ${actionLabel} werden.`,
      );
      // The steps that went through are persisted: a retry must not copy them twice.
      // A failed top-level folder carries its selected subfolders along.
      setMoveCopyDialog((current) =>
        current
          ? {
              ...current,
              documents: documentsToProcess.filter((document) => !succeededIds.has(document.id)),
              folders: topLevelFoldersToProcess.filter((folder) => !succeededIds.has(folder.id)),
            }
          : current,
      );
      return;
    }

    // Moved documents leave the current folder before the refresh lands.
    if (mode === 'move' && visibleView === 'folders') {
      for (const document of documentsToProcess) {
        documentList.remove(document.id);
      }
    }
    onSuccess();
    selection.clearSelection();
    showFeedback(
      'success',
      itemCount === 1 ? `1 Eintrag wurde ${actionLabel}.` : `${itemCount} Einträge wurden ${actionLabel}.`,
    );
  }

  function openMoveCopyDialog(item: DocumentMoveCopyItem, mode: MoveCopyMode) {
    if (isTrashView) return;

    const shouldUseCurrentSelection =
      item.kind === 'document'
        ? selectedDocuments.some((document) => document.id === item.document.id)
        : selectedFolders.some((folder) => folder.id === item.folder.id);
    const documentsToUse = shouldUseCurrentSelection
      ? selectedDocuments
      : item.kind === 'document'
        ? [item.document]
        : [];
    const foldersToUse = shouldUseCurrentSelection
      ? selectedFolders
      : item.kind === 'folder'
        ? [item.folder]
        : [];

    setMoveCopyDialog({
      mode,
      documents: documentsToUse,
      folders: foldersToUse,
      sourceFolderId: getSharedSourceFolderId({
        documentsToCheck: documentsToUse,
        foldersToCheck: foldersToUse,
        fallbackFolderId: currentFolderId,
      }),
    });
  }

  function openMoveCopyDialogForSelection(mode: MoveCopyMode) {
    if (isTrashView || selectedItemCount === 0) return;

    setMoveCopyDialog({
      mode,
      documents: selectedDocuments,
      folders: selectedFolders,
      sourceFolderId: getSharedSourceFolderId({
        documentsToCheck: selectedDocuments,
        foldersToCheck: selectedFolders,
        fallbackFolderId: currentFolderId,
      }),
    });
  }

  function handleMoveCopyConfirm(destinationFolderId: string | null) {
    if (!moveCopyDialog) return;

    void runMoveCopyOperation({
      mode: moveCopyDialog.mode,
      documentsToProcess: moveCopyDialog.documents,
      foldersToProcess: moveCopyDialog.folders,
      destinationFolderId,
      onSuccess: () => {
        setMoveCopyDialog(null);
        moveCopyBatch.reset();
      },
    });
  }

  function handleMoveCopyOpenChange(open: boolean) {
    if (open || moveCopyBatch.isRunning) return;
    setMoveCopyDialog(null);
    setMoveCopyError(null);
    moveCopyBatch.reset();
  }

  return {
    moveCopyDialog,
    moveCopyError,
    isRunning: moveCopyBatch.isRunning,
    progress: moveCopyBatch.isRunning ? moveCopyBatch.progress : null,
    openMoveCopyDialog,
    openMoveCopyDialogForSelection,
    handleMoveCopyConfirm,
    handleMoveCopyOpenChange,
  };
}
