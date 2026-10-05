'use client';

import { useState } from 'react';

import { renameDocument, renameDocumentFolder } from '@/lib/documents/actions';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import type { DocumentLibraryMutations } from './use-document-library-mutations';

type RenameDialogState =
  | { kind: 'folder'; id: string; currentName: string }
  | { kind: 'document'; id: string; currentName: string }
  | null;

export type DocumentRename = ReturnType<typeof useDocumentRename>;

/** State and submit of the rename dialog for one folder or one document. */
export function useDocumentRename({
  isTrashView,
  mutations,
}: {
  isTrashView: boolean;
  mutations: DocumentLibraryMutations;
}) {
  const { busy, settleAfterRefresh } = mutations;
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const isRenamePending = renameDialog ? busy.isBusy(renameDialog.id) : false;

  function openRenameFolderDialog(folder: DocumentFolder) {
    setRenameError(null);
    setRenameDialog({
      kind: 'folder',
      id: folder.id,
      currentName: folder.name,
    });
    setRenameValue(folder.name);
  }

  function openRenameDocumentDialog(document: OrganizationDocument) {
    if (isTrashView) return;
    setRenameError(null);
    setRenameDialog({
      kind: 'document',
      id: document.id,
      currentName: document.displayName,
    });
    setRenameValue(document.displayName);
  }

  function handleRenameConfirm() {
    if (!renameDialog) return;
    const nextName = renameValue.trim();
    if (!nextName || nextName === renameDialog.currentName) {
      setRenameDialog(null);
      return;
    }

    const target = renameDialog;
    const renameFailure =
      target.kind === 'folder'
        ? 'Der Ordner konnte nicht umbenannt werden.'
        : 'Die Datei konnte nicht umbenannt werden.';
    setRenameError(null);
    void busy
      .run(target.id, async () => {
        const result =
          target.kind === 'folder'
            ? await renameDocumentFolder({
                folderId: target.id,
                name: nextName,
              })
            : await renameDocument({
                documentId: target.id,
                displayName: nextName,
              });
        if (!result.success) {
          setRenameError(renameFailure);
          return;
        }
        setRenameDialog(null);
        await settleAfterRefresh();
      })
      .catch(() => setRenameError(renameFailure));
  }

  function handleRenameOpenChange(open: boolean) {
    if (open) return;
    setRenameDialog(null);
    setRenameError(null);
  }

  function cancelRename() {
    setRenameDialog(null);
  }

  return {
    renameDialog,
    renameValue,
    setRenameValue,
    renameError,
    isRenamePending,
    openRenameFolderDialog,
    openRenameDocumentDialog,
    handleRenameConfirm,
    handleRenameOpenChange,
    cancelRename,
  };
}
