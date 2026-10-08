'use client';

import { useState } from 'react';

import { useServerAction } from '@/hooks/use-server-action';
import { createDocumentFolder } from '@/lib/documents/actions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

export const FOLDER_NAME_INPUT_ID = 'document-folder-name';
const FOLDER_NAME_REQUIRED_MESSAGE = 'Bitte gib einen Ordnernamen ein.';

export type DocumentFolderCreation = ReturnType<typeof useDocumentFolderCreation>;

/**
 * State and submit of the „Ordner erstellen" dialog. The parent folder is the
 * current folder unless the dialog was opened for another one (the move/copy
 * dialog creates folders where the user is browsing).
 */
export function useDocumentFolderCreation({
  currentFolderId,
  isTrashView,
}: {
  currentFolderId: string | null;
  isTrashView: boolean;
}) {
  const createFolder = useServerAction(createDocumentFolder);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderDialogParentFolderId, setFolderDialogParentFolderId] = useState<string | null | undefined>(
    undefined,
  );

  function handleCreateFolder() {
    if (isTrashView) return;
    const name = folderName.trim();
    if (!name) {
      setFolderError(FOLDER_NAME_REQUIRED_MESSAGE);
      focusFirstInvalidField({ [FOLDER_NAME_INPUT_ID]: FOLDER_NAME_REQUIRED_MESSAGE });
      return;
    }
    const parentFolderId =
      folderDialogParentFolderId === undefined ? currentFolderId : folderDialogParentFolderId;

    const folderFailure = 'Der Ordner konnte nicht erstellt werden.';
    setFolderError(null);
    void createFolder
      .run({ name, parentFolderId })
      .then((result) => {
        if (!result.success) {
          setFolderError(folderFailure);
          return;
        }
        setFolderName('');
        setFolderDialogOpen(false);
        setFolderDialogParentFolderId(undefined);
      })
      .catch(() => setFolderError(folderFailure));
  }

  function openCreateFolderDialog(parentFolderId: string | null = currentFolderId) {
    setFolderDialogParentFolderId(parentFolderId);
    setFolderName('');
    setFolderError(null);
    setFolderDialogOpen(true);
  }

  function handleFolderDialogOpenChange(open: boolean) {
    setFolderDialogOpen(open);
    if (open) return;
    setFolderDialogParentFolderId(undefined);
    setFolderName('');
    setFolderError(null);
  }

  function cancelFolderDialog() {
    handleFolderDialogOpenChange(false);
  }

  return {
    folderDialogOpen,
    folderName,
    setFolderName,
    folderError,
    isCreatePending: createFolder.isPending,
    handleCreateFolder,
    openCreateFolderDialog,
    handleFolderDialogOpenChange,
    cancelFolderDialog,
  };
}
