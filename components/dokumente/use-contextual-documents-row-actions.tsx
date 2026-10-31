'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { Undo2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { unlinkDocument } from '@/lib/documents/actions';
import {
  deleteDocument,
  renameDocument as renameDocumentAction,
  restoreDocument,
} from '@/lib/documents/library-actions';
import type { OrganizationDocument } from '@/lib/documents/types';

type ContextualDocumentRowActionsOptions = {
  /** Row-scoped pending runner (`useBusyIds().run`) keyed by document id. */
  runBusy: (documentId: string, task: () => Promise<void>) => Promise<void>;
  /** Resolves once the documents rendered by the action's response arrived. */
  waitForDocuments: () => Promise<void>;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setRecentlyUploadedDocuments: Dispatch<SetStateAction<OrganizationDocument[]>>;
};

type ContextualDocumentRowActions = {
  renameDocument: OrganizationDocument | null;
  renameValue: string;
  renameError: string | null;
  setRenameValue: Dispatch<SetStateAction<string>>;
  startRename: (document: OrganizationDocument) => void;
  cancelRename: () => void;
  /** Closing the rename dialog also drops its error. */
  closeRenameDialog: () => void;
  handleRenameConfirm: () => void;
  handleUnlink: (document: OrganizationDocument, linkId: string) => void;
  handleTrash: (target: OrganizationDocument) => void;
};

function showRowFeedback(
  { showBanner }: ContextualDocumentRowActionsOptions,
  variant: 'success' | 'error',
  message: string,
): void {
  showBanner({ variant, message });
}

// A thrown action (network, session) must not vanish behind `void`.
function runRowTask(
  options: ContextualDocumentRowActionsOptions,
  documentId: string,
  task: () => Promise<void>,
  failureMessage: string,
): void {
  void options.runBusy(documentId, task).catch(() => showRowFeedback(options, 'error', failureMessage));
}

function unlinkRowDocument(
  options: ContextualDocumentRowActionsOptions,
  document: OrganizationDocument,
  linkId: string,
): void {
  const { waitForDocuments, setRecentlyUploadedDocuments } = options;
  const unlinkFailure = 'Die Verknüpfung konnte nicht entfernt werden.';
  runRowTask(
    options,
    document.id,
    async () => {
      const result = await unlinkDocument({ linkId });
      if (!result.success) {
        showRowFeedback(options, 'error', unlinkFailure);
        return;
      }
      setRecentlyUploadedDocuments((current) =>
        current.filter((recentDocument) => recentDocument.id !== document.id),
      );
      showRowFeedback(
        options,
        'success',
        'Verknüpfung wurde entfernt. Die Datei bleibt in der Dokumentenablage.',
      );
      await waitForDocuments();
    },
    unlinkFailure,
  );
}

function trashRowDocument(options: ContextualDocumentRowActionsOptions, target: OrganizationDocument): void {
  const { waitForDocuments, showBanner, setRecentlyUploadedDocuments } = options;
  const trashFailure = 'Die Datei konnte nicht gelöscht werden.';
  const restoreFailure = 'Die Datei konnte nicht wiederhergestellt werden.';
  runRowTask(
    options,
    target.id,
    async () => {
      const result = await deleteDocument(target.id);
      if (!result.success) {
        showRowFeedback(options, 'error', trashFailure);
        return;
      }
      setRecentlyUploadedDocuments((current) =>
        current.filter((recentDocument) => recentDocument.id !== target.id),
      );
      showBanner({
        variant: 'success',
        message: 'Datei wurde in den Papierkorb verschoben.',
        actionLabel: 'Rückgängig',
        actionIcon: <Undo2 className="size-3.5" />,
        onAction: () =>
          runRowTask(
            options,
            target.id,
            async () => {
              const restored = await restoreDocument(target.id);
              if (!restored.success) {
                showRowFeedback(options, 'error', restoreFailure);
                return;
              }
              showRowFeedback(options, 'success', 'Datei wurde wiederhergestellt.');
              await waitForDocuments();
            },
            restoreFailure,
          ),
      });
      await waitForDocuments();
    },
    trashFailure,
  );
}

/** Rename, unlink and trash of one document row, each pending on its own row. */
export function useContextualDocumentRowActions(
  options: ContextualDocumentRowActionsOptions,
): ContextualDocumentRowActions {
  const { runBusy, waitForDocuments, setRecentlyUploadedDocuments } = options;
  const [renameDocument, setRenameDocument] = useState<OrganizationDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  function startRename(document: OrganizationDocument): void {
    setRenameError(null);
    setRenameDocument(document);
    setRenameValue(document.displayName);
  }

  function cancelRename(): void {
    setRenameDocument(null);
  }

  function closeRenameDialog(): void {
    setRenameDocument(null);
    setRenameError(null);
  }

  function handleRenameConfirm(): void {
    if (!renameDocument) return;
    const nextName = renameValue.trim();
    if (!nextName || nextName === renameDocument.displayName) {
      setRenameDocument(null);
      return;
    }

    const documentId = renameDocument.id;
    const renameFailure = 'Die Datei konnte nicht umbenannt werden.';
    setRenameError(null);
    void runBusy(documentId, async () => {
      const result = await renameDocumentAction({
        documentId,
        displayName: nextName,
      });
      if (!result.success) {
        setRenameError(renameFailure);
        return;
      }
      setRecentlyUploadedDocuments((current) =>
        current.map((recentDocument) =>
          recentDocument.id === documentId ? { ...recentDocument, displayName: nextName } : recentDocument,
        ),
      );
      setRenameDocument(null);
      await waitForDocuments();
    }).catch(() => setRenameError(renameFailure));
  }

  function handleUnlink(document: OrganizationDocument, linkId: string): void {
    unlinkRowDocument(options, document, linkId);
  }

  function handleTrash(target: OrganizationDocument): void {
    trashRowDocument(options, target);
  }

  return {
    renameDocument,
    renameValue,
    renameError,
    setRenameValue,
    startRename,
    cancelRename,
    closeRenameDialog,
    handleRenameConfirm,
    handleUnlink,
    handleTrash,
  };
}
