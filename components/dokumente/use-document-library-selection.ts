'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { DocumentFolder, DocumentLibraryView, OrganizationDocument } from '@/lib/documents/types';

export type DocumentLibrarySelection = ReturnType<typeof useDocumentLibrarySelection>;

/**
 * The selected documents and folders of the library: checkbox toggles, the
 * table's rectangle selection, and the click outside that clears the selection.
 */
export function useDocumentLibrarySelection({
  documents,
  folders,
  allFolders,
  currentFolderId,
  view,
}: {
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
  allFolders: DocumentFolder[];
  currentFolderId: string | null;
  view: DocumentLibraryView;
}) {
  const suppressNextSelectionClearRef = useRef(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(() => new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(() => new Set());

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedDocumentIds.has(document.id)),
    [documents, selectedDocumentIds],
  );
  const selectedFolders = useMemo(
    () => allFolders.filter((folder) => selectedFolderIds.has(folder.id)),
    [allFolders, selectedFolderIds],
  );
  const selectedItemCount = selectedDocuments.length + selectedFolders.length;

  function removeDocumentsFromSelection(documentIds: string[]) {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      for (const documentId of documentIds) next.delete(documentId);
      return next;
    });
  }

  function removeFolderFromSelection(folderId: string) {
    setSelectedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
  }

  function toggleDocumentSelection(documentId: string) {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }

  function toggleFolderSelection(folderId: string) {
    setSelectedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set());
  }

  function selectAllVisible() {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      for (const document of documents) {
        next.add(document.id);
      }
      return next;
    });
    setSelectedFolderIds((current) => {
      const next = new Set(current);
      for (const folder of folders) {
        next.add(folder.id);
      }
      return next;
    });
  }

  function replaceSelection({
    folderIds,
    documentIds,
  }: {
    folderIds: Set<string>;
    documentIds: Set<string>;
  }) {
    setSelectedFolderIds(folderIds);
    setSelectedDocumentIds(documentIds);
  }

  /** The click that ends a rectangle selection must not clear what it just selected. */
  function suppressNextSelectionClear() {
    suppressNextSelectionClearRef.current = true;
    window.setTimeout(() => {
      suppressNextSelectionClearRef.current = false;
    }, 250);
  }

  // A selection never outlives the folder or view it was made in; cleared during render, never in an effect.
  const [selectionScope, setSelectionScope] = useState({ currentFolderId, view });
  if (currentFolderId !== selectionScope.currentFolderId || view !== selectionScope.view) {
    setSelectionScope({ currentFolderId, view });
    clearSelection();
  }

  useEffect(() => {
    if (selectedItemCount === 0) return;

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (suppressNextSelectionClearRef.current) {
        suppressNextSelectionClearRef.current = false;
        return;
      }
      if (target?.closest('[data-document-selection-circle="true"]')) return;
      if (target?.closest('[data-document-selection-preserve="true"]')) return;
      if (target?.closest('[role="menu"], [data-radix-popper-content-wrapper]')) {
        return;
      }
      window.setTimeout(clearSelection, 0);
    }

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [selectedItemCount]);

  return {
    selectedDocumentIds,
    selectedFolderIds,
    selectedDocuments,
    selectedFolders,
    selectedItemCount,
    removeDocumentsFromSelection,
    removeFolderFromSelection,
    toggleDocumentSelection,
    toggleFolderSelection,
    clearSelection,
    selectAllVisible,
    replaceSelection,
    suppressNextSelectionClear,
  };
}
