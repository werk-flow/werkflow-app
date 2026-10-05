'use client';

import { useState, type TransitionStartFunction } from 'react';

import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type {
  DocumentFolder,
  DocumentLibraryCategoryFilter,
  DocumentLibraryLinkFilter,
  DocumentLibraryView,
  OrganizationDocument,
} from '@/lib/documents/types';
import type { DocumentLibraryRowActions } from './document-library-mobile-list';
import { useDocumentDeleteActions } from './use-document-delete-actions';
import { useDocumentDetailsDialog } from './use-document-details-dialog';
import { useDocumentFolderCreation } from './use-document-folder-creation';
import { useDocumentLibraryDropTargets } from './use-document-library-drop-targets';
import { useDocumentLibraryMutations } from './use-document-library-mutations';
import { useDocumentLibraryNavigation } from './use-document-library-navigation';
import { useDocumentLibrarySelection } from './use-document-library-selection';
import { useDocumentLibraryUpload } from './use-document-library-upload';
import { useDocumentMoveCopy } from './use-document-move-copy';
import { useDocumentRename } from './use-document-rename';
import { useDocumentVersionActions } from './use-document-version-actions';
import { useDocumentViewer } from './use-document-viewer';

export type DocumentLibrary = ReturnType<typeof useDocumentLibrary>;

/**
 * Wires the route payload of the document library to its state hooks and
 * returns them for the page to lay out. Every hook owns one concern; this one
 * only passes them what they need from each other.
 */
export function useDocumentLibrary({
  view,
  initialSearchQuery,
  category,
  linkFilter,
  currentFolderId,
  page,
  folderPage,
  folders,
  allFolders,
  serverDocuments,
  initialDocument,
  initialDocumentId,
  isNavigationPending,
  startNavigationTransition,
}: {
  view: DocumentLibraryView;
  initialSearchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  currentFolderId: string | null;
  page: number;
  folderPage: number;
  folders: DocumentFolder[];
  allFolders: DocumentFolder[];
  serverDocuments: OrganizationDocument[];
  initialDocument: OrganizationDocument | null;
  initialDocumentId: string | null;
  isNavigationPending: boolean;
  startNavigationTransition: TransitionStartFunction;
}) {
  const mutations = useDocumentLibraryMutations(serverDocuments);
  const { documents, busy } = mutations;
  const isMutating = busy.anyBusy || mutations.hasPendingDocumentMutation;
  const selection = useDocumentLibrarySelection({
    documents,
    folders,
    allFolders,
    currentFolderId,
    view,
  });
  const navigation = useDocumentLibraryNavigation({
    view,
    initialSearchQuery,
    category,
    linkFilter,
    currentFolderId,
    page,
    folderPage,
    isMutating,
    isNavigationPending,
    startNavigationTransition,
    clearSelection: selection.clearSelection,
  });
  const { visibleView } = navigation;
  const isTrashView = visibleView === 'trash';
  const canUseUploadActions = visibleView === 'folders' || visibleView === 'all';
  const libraryScope = { isTrashView, mutations };

  const viewer = useDocumentViewer({ initialDocument, initialDocumentId });
  const [linkDialog, setLinkDialog] = useState<OrganizationDocument | null>(null);
  const folderCreation = useDocumentFolderCreation({
    currentFolderId,
    isTrashView,
    refreshDocuments: mutations.refreshDocuments,
  });
  const rename = useDocumentRename(libraryScope);
  const deleteActions = useDocumentDeleteActions({ mutations, selection });
  const moveCopy = useDocumentMoveCopy({
    ...libraryScope,
    allFolders,
    currentFolderId,
    visibleView,
    selection,
  });
  const details = useDocumentDetailsDialog(libraryScope);
  const versionActions = useDocumentVersionActions({ details, mutations });
  const dropTargets = useDocumentLibraryDropTargets({
    ...libraryScope,
    documents,
    folders,
    allFolders,
    currentFolderId,
    visibleView,
    selection,
    onDeleteSelection: deleteActions.openDeleteConfirmationForSelection,
  });
  const upload = useDocumentLibraryUpload({
    canUseUploadActions,
    isNavigationPending,
  });

  useRealtimeRouterRefresh({
    tables: ['documents', 'document_folders', 'document_links'],
  });

  const rowActions: DocumentLibraryRowActions = {
    onOpenFolder: (folder) => navigation.navigateToFolder(folder.id),
    onRenameFolder: rename.openRenameFolderDialog,
    onMoveFolder: (folder) => moveCopy.openMoveCopyDialog({ kind: 'folder', folder }, 'move'),
    onCopyFolder: (folder) => moveCopy.openMoveCopyDialog({ kind: 'folder', folder }, 'copy'),
    onDeleteFolder: deleteActions.handleDeleteFolder,
    onOpenDocument: viewer.openDocumentViewer,
    onDetailsDocument: details.openDetailsDialog,
    onRenameDocument: rename.openRenameDocumentDialog,
    onLinkDocument: (document) => {
      if (isTrashView) return;
      setLinkDialog(document);
    },
    onMoveDocument: (document) => moveCopy.openMoveCopyDialog({ kind: 'document', document }, 'move'),
    onCopyDocument: (document) => moveCopy.openMoveCopyDialog({ kind: 'document', document }, 'copy'),
    onDeleteDocument: deleteActions.handleDeleteDocument,
    onRestoreDocument: deleteActions.handleRestoreDocument,
    onPermanentDeleteDocument: deleteActions.handlePermanentDeleteDocument,
  };

  return {
    documents,
    isMutating,
    isTrashView,
    canUseUploadActions,
    mutations,
    selection,
    navigation,
    viewer,
    linkDialog,
    closeLinkDialog: () => setLinkDialog(null),
    folderCreation,
    rename,
    deleteActions,
    moveCopy,
    details,
    versionActions,
    dropTargets,
    upload,
    rowActions,
    openBatchMoveSelectionDialog: () => moveCopy.openMoveCopyDialogForSelection('move'),
    openBatchCopySelectionDialog: () => moveCopy.openMoveCopyDialogForSelection('copy'),
  };
}
