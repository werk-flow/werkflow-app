'use client';

import { useMemo, useState } from 'react';
import { FolderPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import {
  getDescendantFolderIds,
  getFolderPath,
  getSelectedSourceFolderKeys,
  getSourceFolderKey,
} from '@/lib/documents/folder-tree';
import {
  MoveDestinationBreadcrumbs,
  MoveDestinationDocumentRow,
  MoveDestinationFolderRow,
  MoveDestinationFooter,
  MoveDestinationSidebar,
  type MoveDestinationMode,
} from './document-move-destination-sections';

type MoveDestinationDialogProps = {
  open: boolean;
  mode: MoveDestinationMode;
  title: string;
  description: string;
  allFolders: DocumentFolder[];
  visibleDocuments: OrganizationDocument[];
  selectedDocuments: OrganizationDocument[];
  selectedFolders: DocumentFolder[];
  sourceFolderId: string | null;
  isPending: boolean;
  /** 0 to 100 while the bulk operation runs, null otherwise. */
  progress: number | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetFolderId: string | null) => void;
  onCreateFolder: (parentFolderId: string | null) => void;
  onOpenDocument: (document: OrganizationDocument) => void;
};

/** What the dialog lists for the folder being browsed, and whether that folder may be the destination. */
function useMoveDestinationFolder({
  mode,
  currentFolderId,
  allFolders,
  visibleDocuments,
  selectedDocuments,
  selectedFolders,
  isPending,
}: Pick<
  MoveDestinationDialogProps,
  'mode' | 'allFolders' | 'visibleDocuments' | 'selectedDocuments' | 'selectedFolders' | 'isPending'
> & { currentFolderId: string | null }) {
  const selectedFolderIds = useMemo(
    () => new Set(selectedFolders.map((folder) => folder.id)),
    [selectedFolders],
  );
  const selectedDocumentIds = useMemo(
    () => new Set(selectedDocuments.map((document) => document.id)),
    [selectedDocuments],
  );
  const foldersById = useMemo(() => new Map(allFolders.map((folder) => [folder.id, folder])), [allFolders]);
  const descendantFolderIds = useMemo(
    () => getDescendantFolderIds(allFolders, selectedFolderIds),
    [allFolders, selectedFolderIds],
  );
  const breadcrumbFolders = useMemo(
    () => getFolderPath(foldersById, currentFolderId),
    [currentFolderId, foldersById],
  );
  const childFolders = useMemo(
    () =>
      allFolders
        .filter((folder) => folder.parentFolderId === currentFolderId)
        .sort((firstFolder, secondFolder) =>
          firstFolder.name.localeCompare(secondFolder.name, 'de-DE', {
            numeric: true,
            sensitivity: 'base',
          }),
        ),
    [allFolders, currentFolderId],
  );
  const documentsInCurrentFolder = useMemo(
    () => visibleDocuments.filter((document) => document.folderId === currentFolderId),
    [currentFolderId, visibleDocuments],
  );
  const selectedSourceFolderKeys = useMemo(
    () =>
      getSelectedSourceFolderKeys({
        documents: selectedDocuments,
        folders: selectedFolders,
      }),
    [selectedDocuments, selectedFolders],
  );
  const targetFolderIsSelected = currentFolderId !== null && selectedFolderIds.has(currentFolderId);
  const targetFolderIsDescendant = currentFolderId !== null && descendantFolderIds.has(currentFolderId);
  const isSameMoveDestination =
    mode === 'move' && selectedSourceFolderKeys.has(getSourceFolderKey(currentFolderId));
  const confirmDisabled =
    isPending || targetFolderIsSelected || targetFolderIsDescendant || isSameMoveDestination;
  const disabledReason = targetFolderIsSelected
    ? 'Ein Ordner kann nicht in sich selbst verschoben werden.'
    : targetFolderIsDescendant
      ? 'Ein Ordner kann nicht in einen Unterordner von sich selbst verschoben werden.'
      : isSameMoveDestination
        ? 'Wähle einen anderen Zielordner aus.'
        : null;

  return {
    selectedFolderIds,
    selectedDocumentIds,
    descendantFolderIds,
    breadcrumbFolders,
    childFolders,
    documentsInCurrentFolder,
    confirmDisabled,
    disabledReason,
  };
}

/** Folder browser that picks the destination of a move or copy and confirms it. */
export function MoveDestinationDialog({
  open,
  mode,
  title,
  description,
  allFolders,
  visibleDocuments,
  selectedDocuments,
  selectedFolders,
  sourceFolderId,
  isPending,
  progress,
  error,
  onOpenChange,
  onConfirm,
  onCreateFolder,
  onOpenDocument,
}: MoveDestinationDialogProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(sourceFolderId);
  const {
    selectedFolderIds,
    selectedDocumentIds,
    descendantFolderIds,
    breadcrumbFolders,
    childFolders,
    documentsInCurrentFolder,
    confirmDisabled,
    disabledReason,
  } = useMoveDestinationFolder({
    mode,
    currentFolderId,
    allFolders,
    visibleDocuments,
    selectedDocuments,
    selectedFolders,
    isPending,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent className="flex h-[min(780px,90vh)] !w-[min(1280px,calc(100vw-3rem))] !max-w-none flex-col gap-0 overflow-hidden p-0 sm:!max-w-none">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
            <div className="flex shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onCreateFolder(currentFolderId)}
                disabled={isPending}
              >
                <FolderPlus className="size-4" />
                Neuer Ordner
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-muted/20 lg:grid-cols-[240px_minmax(0,1fr)]">
          <MoveDestinationSidebar
            mode={mode}
            currentFolderId={currentFolderId}
            selectedDocuments={selectedDocuments}
            selectedFolders={selectedFolders}
            onSelectFolder={setCurrentFolderId}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <MoveDestinationBreadcrumbs
              currentFolderId={currentFolderId}
              breadcrumbFolders={breadcrumbFolders}
              onSelectFolder={setCurrentFolderId}
            />

            <div
              className="min-h-0 flex-1 overflow-auto p-4"
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="overflow-hidden rounded-md border bg-background">
                <div className="grid grid-cols-[minmax(0,1fr)] border-b px-4 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_140px_160px]">
                  <span>Name</span>
                  <span className="hidden sm:inline">Typ</span>
                  <span className="hidden sm:inline">Geändert</span>
                </div>
                <div className="divide-y">
                  {childFolders.map((folder) => (
                    <MoveDestinationFolderRow
                      key={folder.id}
                      folder={folder}
                      isDisabled={selectedFolderIds.has(folder.id) || descendantFolderIds.has(folder.id)}
                      onSelectFolder={setCurrentFolderId}
                    />
                  ))}
                  {documentsInCurrentFolder.map((document) => (
                    <MoveDestinationDocumentRow
                      key={document.id}
                      document={document}
                      isSelected={selectedDocumentIds.has(document.id)}
                      onOpenDocument={onOpenDocument}
                    />
                  ))}
                  {childFolders.length === 0 && documentsInCurrentFolder.length === 0 && (
                    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                      Dieser Ordner ist leer.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <MoveDestinationFooter
              mode={mode}
              isPending={isPending}
              progress={progress}
              error={error}
              disabledReason={disabledReason}
              confirmDisabled={confirmDisabled}
              onCancel={() => onOpenChange(false)}
              onConfirm={() => onConfirm(currentFolderId)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
