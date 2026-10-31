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

type DocumentLibraryOptions = {
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
};

/** The selection and the folder, view and search navigation that clears it. */
function useDocumentLibraryLocation(
  options: DocumentLibraryOptions & { documents: OrganizationDocument[]; isMutating: boolean },
) {
  const { documents, folders, allFolders, currentFolderId, view } = options;
  const selection = useDocumentLibrarySelection({
    documents,
    folders,
    allFolders,
    currentFolderId,
    view,
  });
  const navigation = useDocumentLibraryNavigation({
    view,
    initialSearchQuery: options.initialSearchQuery,
    category: options.category,
    linkFilter: options.linkFilter,
    currentFolderId,
    page: options.page,
    folderPage: options.folderPage,
    isMutating: options.isMutating,
    isNavigationPending: options.isNavigationPending,
    startNavigationTransition: options.startNavigationTransition,
    clearSelection: selection.clearSelection,
  });
  return { selection, navigation };
}

/** The row drag onto folders and the trash, the upload intake, and the live refresh of the library tables. */
function useDocumentLibraryIntake({
  dropTargetOptions,
  canUseUploadActions,
  isNavigationPending,
}: {
  dropTargetOptions: Parameters<typeof useDocumentLibraryDropTargets>[0];
  canUseUploadActions: boolean;
  isNavigationPending: boolean;
}) {
  const dropTargets = useDocumentLibraryDropTargets(dropTargetOptions);
  const upload = useDocumentLibraryUpload({
    canUseUploadActions,
    isNavigationPending,
  });

  useRealtimeRouterRefresh({
    tables: ['documents', 'document_folders', 'document_links'],
  });

  return { dropTargets, upload };
}

/** The row menu entries, each opening its dialog or running its action. */
function buildRowActions({
  isTrashView,
  navigation,
  rename,
  moveCopy,
  deleteActions,
  viewer,
  details,
  setLinkDialog,
}: {
  isTrashView: boolean;
  navigation: ReturnType<typeof useDocumentLibraryNavigation>;
  rename: ReturnType<typeof useDocumentRename>;
  moveCopy: ReturnType<typeof useDocumentMoveCopy>;
  deleteActions: ReturnType<typeof useDocumentDeleteActions>;
  viewer: ReturnType<typeof useDocumentViewer>;
  details: ReturnType<typeof useDocumentDetailsDialog>;
  setLinkDialog: (document: OrganizationDocument) => void;
}): DocumentLibraryRowActions {
  return {
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
}

/**
 * Wires the route payload of the document library to its state hooks and
 * returns them for the page to lay out. Every hook owns one concern; this one
 * only passes them what they need from each other.
 */
export function useDocumentLibrary(options: DocumentLibraryOptions) {
  const { currentFolderId, folders, allFolders, serverDocuments, initialDocument, initialDocumentId } =
    options;
  const mutations = useDocumentLibraryMutations(serverDocuments);
  const { documents, busy } = mutations;
  const isMutating = busy.anyBusy || mutations.hasPendingDocumentMutation;
  const { selection, navigation } = useDocumentLibraryLocation({ ...options, documents, isMutating });
  const { visibleView } = navigation;
  const isTrashView = visibleView === 'trash';
  const canUseUploadActions = visibleView === 'folders' || visibleView === 'all';
  const libraryScope = { isTrashView, mutations };

  const viewer = useDocumentViewer({ initialDocument, initialDocumentId });
  const [linkDialog, setLinkDialog] = useState<OrganizationDocument | null>(null);
  const folderCreation = useDocumentFolderCreation({ currentFolderId, isTrashView });
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
  const { dropTargets, upload } = useDocumentLibraryIntake({
    dropTargetOptions: {
      ...libraryScope,
      documents,
      folders,
      allFolders,
      currentFolderId,
      visibleView,
      selection,
      onDeleteSelection: deleteActions.openDeleteConfirmationForSelection,
    },
    canUseUploadActions,
    isNavigationPending: options.isNavigationPending,
  });

  const rowActions = buildRowActions({
    isTrashView,
    navigation,
    rename,
    moveCopy,
    deleteActions,
    viewer,
    details,
    setLinkDialog,
  });

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
