'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { DocumentFolder, DocumentLibraryView, OrganizationDocument } from '@/lib/documents/types';

export type DocumentLibrarySelection = ReturnType<typeof useDocumentLibrarySelection>;

function withoutIds(current: Set<string>, ids: Iterable<string>): Set<string> {
  const next = new Set(current);
  for (const id of ids) next.delete(id);
  return next;
}

function withIds(current: Set<string>, ids: Iterable<string>): Set<string> {
  const next = new Set(current);
  for (const id of ids) next.add(id);
  return next;
}

function withIdToggled(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/** Inside a selection circle, a preserving region or an open menu, a click keeps the selection. */
function preservesSelection(target: Element | null): boolean {
  if (target?.closest('[data-document-selection-circle="true"]')) return true;
  if (target?.closest('[data-document-selection-preserve="true"]')) return true;
  return Boolean(target?.closest('[role="menu"], [data-radix-popper-content-wrapper]'));
}

type SelectionSetters = {
  setSelectedDocumentIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFolderIds: Dispatch<SetStateAction<Set<string>>>;
};

/** The updates of the selected id sets that toggle, add or remove single ids. */
function createSelectionUpdates({
  documents,
  folders,
  setSelectedDocumentIds,
  setSelectedFolderIds,
}: SelectionSetters & { documents: OrganizationDocument[]; folders: DocumentFolder[] }) {
  return {
    removeDocumentsFromSelection: (documentIds: string[]) => {
      setSelectedDocumentIds((current) => withoutIds(current, documentIds));
    },
    removeFolderFromSelection: (folderId: string) => {
      setSelectedFolderIds((current) => withoutIds(current, [folderId]));
    },
    toggleDocumentSelection: (documentId: string) => {
      setSelectedDocumentIds((current) => withIdToggled(current, documentId));
    },
    toggleFolderSelection: (folderId: string) => {
      setSelectedFolderIds((current) => withIdToggled(current, folderId));
    },
    selectAllVisible: () => {
      setSelectedDocumentIds((current) =>
        withIds(
          current,
          documents.map((document) => document.id),
        ),
      );
      setSelectedFolderIds((current) =>
        withIds(
          current,
          folders.map((folder) => folder.id),
        ),
      );
    },
    replaceSelection: ({ folderIds, documentIds }: { folderIds: Set<string>; documentIds: Set<string> }) => {
      setSelectedFolderIds(folderIds);
      setSelectedDocumentIds(documentIds);
    },
  };
}

type DocumentLibrarySelectionOptions = {
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
  allFolders: DocumentFolder[];
  currentFolderId: string | null;
  view: DocumentLibraryView;
};

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
}: DocumentLibrarySelectionOptions) {
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
  const selectionUpdates = createSelectionUpdates({
    documents,
    folders,
    setSelectedDocumentIds,
    setSelectedFolderIds,
  });

  function clearSelection() {
    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set());
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
      const target = event.target instanceof Element ? event.target : null;
      if (suppressNextSelectionClearRef.current) {
        suppressNextSelectionClearRef.current = false;
        return;
      }
      if (preservesSelection(target)) return;
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
    ...selectionUpdates,
    clearSelection,
    suppressNextSelectionClear,
  };
}
