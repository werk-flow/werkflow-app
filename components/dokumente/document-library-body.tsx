'use client';

import { DokumenteTabContentSkeleton } from '@/components/loading-states/dokumente-page-skeleton';
import { ListPagination } from '@/components/shared/list-pagination';
import type {
  DocumentEmployee,
  DocumentFolder,
  DocumentLibraryView,
  OrganizationDocument,
} from '@/lib/documents/types';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';
import { DocumentLibraryMobileList, type DocumentLibraryRowActions } from './document-library-mobile-list';
import { DocumentLibraryTable } from './document-library-table';
import { DocumentWorkContextView } from './document-work-context-view';
import type { DocumentLibraryDropTargets } from './use-document-library-drop-targets';
import type { DocumentLibrarySelection } from './use-document-library-selection';

type DocumentLibraryBodyProps = {
  /** The view a pending navigation leads to; its skeleton replaces the content. */
  pendingView: DocumentLibraryView | null;
  isWorkView: boolean;
  isTrashView: boolean;
  searchQuery: string;
  folders: DocumentFolder[];
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
  folderPage: number;
  folderTotal: number;
  isPaginationBusy: boolean;
  isItemBusy: (itemId: string) => boolean;
  rowActions: DocumentLibraryRowActions;
  selection: DocumentLibrarySelection;
  dropTargets: DocumentLibraryDropTargets;
  onFolderPageChange: (nextPage: number) => void;
  onBatchMoveSelection: () => void;
  onBatchCopySelection: () => void;
  onBatchDeleteSelection: () => void;
};

/** The library's content below the toolbar: navigation skeleton, link view, or cards plus table. */
export function DocumentLibraryBody({
  pendingView,
  isWorkView,
  isTrashView,
  searchQuery,
  folders,
  documents,
  jobs,
  projects,
  clients,
  employees,
  folderPage,
  folderTotal,
  isPaginationBusy,
  isItemBusy,
  rowActions,
  selection,
  dropTargets,
  onFolderPageChange,
  onBatchMoveSelection,
  onBatchCopySelection,
  onBatchDeleteSelection,
}: DocumentLibraryBodyProps) {
  if (pendingView !== null) {
    return (
      <DokumenteTabContentSkeleton
        view={
          pendingView === 'work'
            ? 'work'
            : pendingView === 'all'
              ? 'all'
              : pendingView === 'trash'
                ? 'trash'
                : 'folders'
        }
      />
    );
  }

  if (isWorkView) {
    return (
      <DocumentWorkContextView
        documents={documents}
        jobs={jobs}
        projects={projects}
        clients={clients}
        employees={employees}
        isPending={false}
        isItemPending={isItemBusy}
        onOpenDocument={rowActions.onOpenDocument}
        onDetailsDocument={rowActions.onDetailsDocument}
        onRenameDocument={rowActions.onRenameDocument}
        onLinkDocument={rowActions.onLinkDocument}
        onMoveDocument={rowActions.onMoveDocument}
        onCopyDocument={rowActions.onCopyDocument}
        onDeleteDocument={rowActions.onDeleteDocument}
      />
    );
  }

  return (
    <>
      <DocumentLibraryMobileList
        folders={folders}
        documents={documents}
        selectedFolderIds={selection.selectedFolderIds}
        selectedDocumentIds={selection.selectedDocumentIds}
        isTrashView={isTrashView}
        searchQuery={searchQuery}
        isItemBusy={isItemBusy}
        rowActions={rowActions}
        onToggleFolderSelection={selection.toggleFolderSelection}
        onToggleDocumentSelection={selection.toggleDocumentSelection}
      />

      {folderTotal > 50 && (
        <ListPagination
          label="Ordner"
          page={folderPage}
          total={folderTotal}
          busy={isPaginationBusy}
          onPageChange={onFolderPageChange}
        />
      )}
      <DocumentLibraryTable
        folders={folders}
        documents={documents}
        selectedFolderIds={selection.selectedFolderIds}
        selectedDocumentIds={selection.selectedDocumentIds}
        isTrashView={isTrashView}
        searchQuery={searchQuery}
        isPending={false}
        isItemPending={isItemBusy}
        {...rowActions}
        onToggleFolderSelection={selection.toggleFolderSelection}
        onToggleDocumentSelection={selection.toggleDocumentSelection}
        onSelectAllVisible={selection.selectAllVisible}
        onClearSelection={selection.clearSelection}
        onBatchMoveSelection={onBatchMoveSelection}
        onBatchCopySelection={onBatchCopySelection}
        onBatchDeleteSelection={onBatchDeleteSelection}
        onRectangleSelectionChange={selection.replaceSelection}
        onRectangleSelectionComplete={selection.suppressNextSelectionClear}
        onDragSelectionStart={dropTargets.setDraggedTableSelection}
        onDragSelectionEnd={dropTargets.handleDragSelectionEnd}
        onMoveItemsToFolder={dropTargets.handleMoveItemsToFolder}
        onMoveItemsToTrash={dropTargets.handleMoveItemsToTrash}
        onPointerDropTargetChange={dropTargets.handlePointerDropTargetChange}
        canDropSelectionIntoFolder={dropTargets.canDropSelectionIntoFolder}
      />
    </>
  );
}
