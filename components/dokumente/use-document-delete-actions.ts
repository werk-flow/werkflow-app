'use client';

import { useState } from 'react';

import { describeFailure } from '@/lib/action-messages';
import { deleteDocument, deleteDocumentFolder, permanentlyDeleteDocument } from '@/lib/documents/actions';
import type { DocumentFolder, DocumentMutationResult, OrganizationDocument } from '@/lib/documents/types';
import type { DocumentLibraryMutations } from './use-document-library-mutations';
import type { DocumentLibrarySelection } from './use-document-library-selection';

const PERMANENT_DELETE_ERROR_MESSAGES = {
  document_has_equipment_history:
    'Die Datei gehört zur Anlagenhistorie und kann nicht endgültig gelöscht werden. Entferne zuerst die Anlagenverknüpfung.',
} satisfies Record<string, string>;

export type DocumentConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
} | null;

// Folders have no restore action, so a selection that contains one reports
// without offering „Rückgängig".
async function trashDocumentsAndFolders({
  mutations,
  documentsToDelete,
  foldersToDelete,
}: {
  mutations: DocumentLibraryMutations;
  documentsToDelete: OrganizationDocument[];
  foldersToDelete: DocumentFolder[];
}): Promise<void> {
  const { mutateDocuments, runMutation, showFeedback, settleAfterRefresh } = mutations;
  const itemCount = documentsToDelete.length + foldersToDelete.length;
  const selectedItemLabel = itemCount === 1 ? '1 Eintrag' : `${itemCount} Einträge`;
  const { failedCount: failedDocumentCount } = await mutateDocuments(documentsToDelete, deleteDocument);
  let failedCount = failedDocumentCount;
  for (const folder of foldersToDelete) {
    const succeeded = await runMutation(folder.id, () => deleteDocumentFolder(folder.id));
    if (!succeeded) failedCount++;
  }

  if (failedCount > 0) {
    const failedItemLabel = failedCount === 1 ? '1 Eintrag' : `${failedCount} Einträge`;
    showFeedback(
      'error',
      `${failedItemLabel} ${failedCount === 1 ? 'konnte' : 'konnten'} nicht gelöscht werden.`,
    );
  } else {
    showFeedback(
      'success',
      `${selectedItemLabel} ${itemCount === 1 ? 'wurde' : 'wurden'} in den Papierkorb verschoben.`,
    );
  }
  if (failedCount < itemCount) await settleAfterRefresh();
}

/**
 * Trash, restore and permanent delete of documents and folders, each behind
 * the library's one confirmation dialog.
 */
export function useDocumentDeleteActions({
  mutations,
  selection,
}: {
  mutations: DocumentLibraryMutations;
  selection: DocumentLibrarySelection;
}) {
  const {
    documentList,
    busy,
    showFeedback,
    refreshDocuments,
    runMutation,
    settleAfterRefresh,
    runDocumentMutationFlow,
    trashDocuments,
    restoreDocuments,
  } = mutations;
  const { clearSelection, removeDocumentsFromSelection } = selection;
  const [confirmDialog, setConfirmDialog] = useState<DocumentConfirmDialogState>(null);

  function handleDeleteFolder(folder: DocumentFolder) {
    setConfirmDialog({
      title: 'Ordner löschen?',
      description: `Der Ordner „${folder.name}“ und alle enthaltenen Dateien werden in den Papierkorb verschoben.`,
      confirmLabel: 'Ordner löschen',
      onConfirm: () => {
        selection.removeFolderFromSelection(folder.id);
        // A thrown action counts as a failure, so the error shows in both cases.
        void runMutation(folder.id, async () => {
          const result = await deleteDocumentFolder(folder.id);
          if (!result.success) return result;
          showFeedback('success', 'Ordner wurde in den Papierkorb verschoben.');
          await settleAfterRefresh();
          return result;
        }).then((succeeded) => {
          if (!succeeded) showFeedback('error', 'Der Ordner konnte nicht gelöscht werden.');
        });
      },
    });
  }

  function handleDeleteDocument(document: OrganizationDocument) {
    setConfirmDialog({
      title: 'Datei löschen?',
      description: `„${document.displayName}“ wird in den Papierkorb verschoben und kann dort wiederhergestellt werden.`,
      confirmLabel: 'Datei löschen',
      onConfirm: () => {
        removeDocumentsFromSelection([document.id]);
        void trashDocuments([document]);
      },
    });
  }

  function handleRestoreDocument(document: OrganizationDocument) {
    removeDocumentsFromSelection([document.id]);
    void restoreDocuments([document]);
  }

  function handlePermanentDeleteDocument(document: OrganizationDocument) {
    setConfirmDialog({
      title: 'Datei endgültig löschen?',
      description: `„${document.displayName}“ wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`,
      confirmLabel: 'Endgültig löschen',
      onConfirm: () => {
        removeDocumentsFromSelection([document.id]);
        documentList.remove(document.id);
        void busy
          .run(document.id, () => permanentlyDeleteDocument(document.id))
          .catch(
            (): DocumentMutationResult => ({
              success: false,
              error: 'request_failed',
            }),
          )
          .then((result) => {
            if (!result.success) {
              documentList.rollback(document.id);
              showFeedback(
                'error',
                describeFailure(
                  result.error,
                  PERMANENT_DELETE_ERROR_MESSAGES,
                  'Die Datei konnte nicht endgültig gelöscht werden.',
                ),
              );
              return;
            }
            showFeedback('success', 'Datei wurde endgültig gelöscht.');
            refreshDocuments();
          });
      },
    });
  }

  function openDeleteConfirmationForSelection({
    documentsToDelete,
    foldersToDelete,
  }: {
    documentsToDelete: OrganizationDocument[];
    foldersToDelete: DocumentFolder[];
  }) {
    const itemCount = documentsToDelete.length + foldersToDelete.length;
    if (itemCount === 0) return;
    const selectedItemLabel = itemCount === 1 ? '1 Eintrag' : `${itemCount} Einträge`;

    setConfirmDialog({
      title: 'Ausgewählte Einträge löschen?',
      description: `${selectedItemLabel} ${
        itemCount === 1 ? 'wird' : 'werden'
      } in den Papierkorb verschoben.`,
      confirmLabel: 'Einträge löschen',
      onConfirm: () => {
        clearSelection();
        // Documents only: the undoable path.
        if (foldersToDelete.length === 0) {
          void trashDocuments(documentsToDelete);
          return;
        }

        void runDocumentMutationFlow(() =>
          trashDocumentsAndFolders({
            mutations,
            documentsToDelete,
            foldersToDelete,
          }),
        );
      },
    });
  }

  function handleBatchDelete() {
    openDeleteConfirmationForSelection({
      documentsToDelete: selection.selectedDocuments,
      foldersToDelete: selection.selectedFolders,
    });
  }

  function handleBatchRestore() {
    if (selection.selectedDocuments.length === 0) return;
    const documentsToRestore = selection.selectedDocuments;
    clearSelection();
    void restoreDocuments(documentsToRestore);
  }

  return {
    confirmDialog,
    setConfirmDialog,
    handleDeleteFolder,
    handleDeleteDocument,
    handleRestoreDocument,
    handlePermanentDeleteDocument,
    openDeleteConfirmationForSelection,
    handleBatchDelete,
    handleBatchRestore,
  };
}
