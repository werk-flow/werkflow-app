'use client';

import { useTransition } from 'react';

import { ListPagination } from '@/components/shared/list-pagination';
import { useListNavigation } from '@/hooks/use-list-navigation';
import type {
  DocumentEmployee,
  DocumentFolder,
  DocumentLibraryCategoryFilter,
  DocumentLibraryLinkFilter,
  DocumentLibraryView,
  OrganizationDocument,
} from '@/lib/documents/types';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';
import { cn } from '@/lib/utils';
import { DocumentLibraryBody } from './document-library-body';
import { DocumentLibraryBreadcrumbs } from './document-library-breadcrumbs';
import { DocumentLibraryDialogs } from './document-library-dialogs';
import { DocumentLibraryHeaderActions } from './document-library-header-actions';
import { DocumentLibrarySelectionActions } from './document-library-selection-actions';
import { DocumentLibraryToolbar } from './document-library-toolbar';
import { DocumentLibraryViewSwitch } from './document-library-view-switch';
import { MoveDestinationDialog } from './document-move-destination-dialog';
import { useDocumentLibrary } from './use-document-library';
import type { DocumentMoveCopy } from './use-document-move-copy';

type DocumentLibraryContentProps = {
  page: number;
  total: number;
  folderPage: number;
  folderTotal: number;
  view: DocumentLibraryView;
  searchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  currentFolderId: string | null;
  breadcrumbs: DocumentFolder[];
  folders: DocumentFolder[];
  allFolders: DocumentFolder[];
  documents: OrganizationDocument[];
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
  initialDocumentId: string | null;
  initialDocument: OrganizationDocument | null;
  initialDocumentUnavailable: boolean;
};

type DocumentMoveCopyDialogProps = {
  moveCopy: DocumentMoveCopy;
  allFolders: DocumentFolder[];
  documents: OrganizationDocument[];
  onCreateFolder: (parentFolderId: string | null) => void;
  onOpenDocument: (document: OrganizationDocument) => void;
};

/**
 * The destination dialog for the items the move/copy state holds. Each opening
 * remounts it; a retry after a partial failure keeps the chosen destination.
 */
function DocumentMoveCopyDialog({
  moveCopy,
  allFolders,
  documents,
  onCreateFolder,
  onOpenDocument,
}: DocumentMoveCopyDialogProps) {
  const { moveCopyDialog } = moveCopy;

  return (
    <MoveDestinationDialog
      key={
        moveCopyDialog
          ? `${moveCopyDialog.mode}-${moveCopyDialog.sourceFolderId ?? 'root'}`
          : 'move-copy-closed'
      }
      open={!!moveCopyDialog}
      mode={moveCopyDialog?.mode ?? 'move'}
      title={moveCopyDialog?.mode === 'copy' ? 'Kopieren nach' : 'Verschieben nach'}
      description={
        moveCopyDialog && moveCopyDialog.documents.length + moveCopyDialog.folders.length > 1
          ? 'Wähle den Zielordner für die ausgewählten Einträge.'
          : moveCopyDialog?.documents[0] && moveCopyDialog.documents.length === 1
            ? `Wähle den Zielordner für „${moveCopyDialog.documents[0].displayName}“.`
            : moveCopyDialog?.folders[0] && moveCopyDialog.folders.length === 1
              ? `Wähle den Zielordner für „${moveCopyDialog.folders[0].name}“.`
              : 'Wähle den Zielordner.'
      }
      allFolders={allFolders}
      visibleDocuments={documents}
      selectedDocuments={moveCopyDialog?.documents ?? []}
      selectedFolders={moveCopyDialog?.folders ?? []}
      sourceFolderId={moveCopyDialog?.sourceFolderId ?? null}
      isPending={moveCopy.isRunning}
      progress={moveCopy.progress}
      error={moveCopy.moveCopyError}
      onOpenChange={moveCopy.handleMoveCopyOpenChange}
      onConfirm={moveCopy.handleMoveCopyConfirm}
      onCreateFolder={onCreateFolder}
      onOpenDocument={onOpenDocument}
    />
  );
}

/**
 * The document library page. `useDocumentLibrary` owns the state; this
 * component lays out header actions, toolbar, breadcrumbs, content and dialogs.
 * It holds the library's named `useTransition` exception (folder navigation).
 */
export function DocumentLibraryContent({
  page,
  total,
  folderPage,
  folderTotal,
  view,
  searchQuery: initialSearchQuery,
  category,
  linkFilter,
  currentFolderId,
  breadcrumbs,
  folders,
  allFolders,
  documents: serverDocuments,
  jobs,
  projects,
  clients,
  employees,
  initialDocumentId,
  initialDocument,
  initialDocumentUnavailable,
}: DocumentLibraryContentProps) {
  const paginationNavigation = useListNavigation();
  const [isNavigationPending, startNavigationTransition] = useTransition();
  const library = useDocumentLibrary({
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
  });
  const { documents, isTrashView, canUseUploadActions } = library;
  const { selection, navigation, dropTargets, upload, deleteActions } = library;
  const { searchQuery, visibleView } = navigation;

  return (
    <div
      className={cn(
        'flex min-h-[calc(100vh-3rem)] flex-col gap-4 rounded-lg p-2 transition-colors',
        upload.isDragActive && 'bg-primary/5 outline-1 outline-offset-4 outline-dashed outline-primary/80',
      )}
      onDragOver={upload.handleDragOver}
      onDragLeave={upload.handleDragLeave}
      onDrop={upload.handleDrop}
    >
      <DocumentLibraryHeaderActions
        showMenu={!isTrashView}
        menuDisabled={isNavigationPending || !canUseUploadActions}
        canCreateFolder={visibleView === 'folders'}
        fileInputRef={upload.fileInputRef}
        folderInputRef={upload.folderInputRef}
        onCreateFolder={() => library.folderCreation.openCreateFolderDialog(currentFolderId)}
        onFilesChosen={upload.handleUpload}
        onFolderChosen={upload.handleFolderInput}
      />

      {initialDocumentUnavailable && (
        <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Das verknüpfte Dokument wurde nicht gefunden oder ist nicht mehr verfügbar.
        </p>
      )}

      <DocumentLibraryToolbar
        visibleView={visibleView}
        searchQuery={searchQuery}
        category={category}
        linkFilter={linkFilter}
        viewSwitch={
          <DocumentLibraryViewSwitch
            visibleView={visibleView}
            searchQuery={searchQuery}
            category={category}
            linkFilter={linkFilter}
            isMutating={library.isMutating}
            isNavigationPending={isNavigationPending}
            isTrashDragOver={dropTargets.isTrashDragOver}
            onNavigate={navigation.navigateToDocumentLocation}
            onTrashDragOverChange={dropTargets.setIsTrashDragOver}
            onTrashDrop={dropTargets.handleTrashDrop}
          />
        }
        selectionActions={
          selection.selectedItemCount > 0 &&
          visibleView !== 'work' && (
            <DocumentLibrarySelectionActions
              selectedItemCount={selection.selectedItemCount}
              isTrashView={isTrashView}
              isBusy={library.mutations.busy.anyBusy}
              canRestore={selection.selectedDocuments.length > 0}
              onClearSelection={selection.clearSelection}
              onRestore={deleteActions.handleBatchRestore}
              onMove={library.openBatchMoveSelectionDialog}
              onCopy={library.openBatchCopySelectionDialog}
              onDelete={deleteActions.handleBatchDelete}
            />
          )
        }
        onSearchQueryChange={navigation.setSearchQuery}
        onSubmitSearch={(query) =>
          navigation.updateSearch(query === undefined ? {} : { nextSearchQuery: query })
        }
        onCategoryChange={(nextCategory) => navigation.updateSearch({ nextCategory })}
        onLinkFilterChange={(nextLinkFilter) => navigation.updateSearch({ nextLinkFilter })}
      />

      {visibleView === 'folders' && (
        <DocumentLibraryBreadcrumbs
          currentFolderId={currentFolderId}
          breadcrumbs={breadcrumbs}
          dropTargetId={dropTargets.breadcrumbDropTargetId}
          onNavigateToFolder={navigation.navigateToFolder}
          onDragOverFolder={dropTargets.handleBreadcrumbDragOver}
          onDragLeaveFolder={() => dropTargets.setBreadcrumbDropTargetId(null)}
          onDropOnFolder={dropTargets.handleBreadcrumbDrop}
        />
      )}

      {navigation.pendingView === null && (
        <ListPagination
          label="Dokumente"
          page={page}
          total={total}
          busy={paginationNavigation.busy}
          onPageChange={(nextPage) => {
            selection.clearSelection();
            paginationNavigation.navigate({ page: nextPage });
          }}
        />
      )}

      <DocumentLibraryBody
        pendingView={navigation.pendingView}
        isWorkView={visibleView === 'work'}
        isTrashView={isTrashView}
        searchQuery={searchQuery}
        folders={folders}
        documents={documents}
        jobs={jobs}
        projects={projects}
        clients={clients}
        employees={employees}
        folderPage={folderPage}
        folderTotal={folderTotal}
        isPaginationBusy={paginationNavigation.busy}
        isItemBusy={library.mutations.busy.isBusy}
        rowActions={library.rowActions}
        selection={selection}
        dropTargets={dropTargets}
        onFolderPageChange={(nextPage) => {
          selection.clearSelection();
          paginationNavigation.navigate({ folderPage: nextPage });
        }}
        onBatchMoveSelection={library.openBatchMoveSelectionDialog}
        onBatchCopySelection={library.openBatchCopySelectionDialog}
        onBatchDeleteSelection={deleteActions.handleBatchDelete}
      />

      <DocumentLibraryDialogs
        library={library}
        uploadTargetFolderId={visibleView === 'folders' ? currentFolderId : null}
        moveCopyDialog={
          <DocumentMoveCopyDialog
            moveCopy={library.moveCopy}
            allFolders={allFolders}
            documents={documents}
            onCreateFolder={library.folderCreation.openCreateFolderDialog}
            onOpenDocument={library.viewer.openDocumentViewer}
          />
        }
      />
    </div>
  );
}
