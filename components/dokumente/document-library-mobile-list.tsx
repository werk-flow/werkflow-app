'use client';

import { createElement, type ReactElement } from 'react';
import { Folder } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { formatFileSize } from '@/lib/documents/format';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentFolder,
  type OrganizationDocument,
} from '@/lib/documents/types';
import { formatGermanDate as formatDate } from '@/lib/utils';
import { getFileIcon, getLinkBadges } from './document-library-file-labels';
import {
  DocumentActionsMenu,
  DocumentContextMenuContent,
  FolderActionsMenu,
  FolderContextMenuContent,
} from './document-row-actions';

/** What a folder or document row can do; the table and the mobile cards share it. */
export type DocumentLibraryRowActions = {
  onOpenFolder: (folder: DocumentFolder) => void;
  onRenameFolder: (folder: DocumentFolder) => void;
  onMoveFolder: (folder: DocumentFolder) => void;
  onCopyFolder: (folder: DocumentFolder) => void;
  onDeleteFolder: (folder: DocumentFolder) => void;
  onOpenDocument: (document: OrganizationDocument) => void;
  onDetailsDocument: (document: OrganizationDocument) => void;
  onRenameDocument: (document: OrganizationDocument) => void;
  onLinkDocument: (document: OrganizationDocument) => void;
  onMoveDocument: (document: OrganizationDocument) => void;
  onCopyDocument: (document: OrganizationDocument) => void;
  onDeleteDocument: (document: OrganizationDocument) => void;
  onRestoreDocument: (document: OrganizationDocument) => void;
  onPermanentDeleteDocument: (document: OrganizationDocument) => void;
};

type FolderCardProps = {
  folder: DocumentFolder;
  isSelected: boolean;
  isBusy: boolean;
  rowActions: DocumentLibraryRowActions;
  onToggleSelection: (folderId: string) => void;
};

function DocumentLibraryFolderCard({
  folder,
  isSelected,
  isBusy,
  rowActions,
  onToggleSelection,
}: FolderCardProps) {
  const handlers = {
    onOpen: () => rowActions.onOpenFolder(folder),
    onMove: () => rowActions.onMoveFolder(folder),
    onCopy: () => rowActions.onCopyFolder(folder),
    onRename: () => rowActions.onRenameFolder(folder),
    onDelete: () => rowActions.onDeleteFolder(folder),
  };

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <ListRow interactive onClick={() => rowActions.onOpenFolder(folder)}>
          <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelection(folder.id)}
              aria-label={`Ordner ${folder.name} auswählen`}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{folder.name}</span>
                <InlinePending active={isBusy} />
              </p>
              <p className="text-xs text-muted-foreground">Ordner · {formatDate(folder.createdAt)}</p>
            </div>
          </div>
          <div onClick={(event) => event.stopPropagation()}>
            <FolderActionsMenu folder={folder} disabled={isBusy} handlers={handlers} />
          </div>
        </ListRow>
      </ContextMenuTrigger>
      <FolderContextMenuContent folder={folder} handlers={handlers} />
    </ContextMenu>
  );
}

type DocumentCardProps = {
  document: OrganizationDocument;
  isSelected: boolean;
  isBusy: boolean;
  isTrashView: boolean;
  rowActions: DocumentLibraryRowActions;
  onToggleSelection: (documentId: string) => void;
};

function DocumentLibraryDocumentCard({
  document,
  isSelected,
  isBusy,
  isTrashView,
  rowActions,
  onToggleSelection,
}: DocumentCardProps) {
  const linkBadges = getLinkBadges(document);
  const handlers = {
    onOpen: () => rowActions.onOpenDocument(document),
    onDetails: () => rowActions.onDetailsDocument(document),
    onRename: () => rowActions.onRenameDocument(document),
    onLink: () => rowActions.onLinkDocument(document),
    onMove: () => rowActions.onMoveDocument(document),
    onCopy: () => rowActions.onCopyDocument(document),
    onDelete: () => rowActions.onDeleteDocument(document),
    onRestore: () => rowActions.onRestoreDocument(document),
    onPermanentDelete: () => rowActions.onPermanentDeleteDocument(document),
  };

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <ListRow interactive onClick={() => rowActions.onOpenDocument(document)}>
          <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelection(document.id)}
              aria-label={`Datei ${document.displayName} auswählen`}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {createElement(getFileIcon(document), {
              className: 'size-4 shrink-0 text-muted-foreground',
            })}
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{document.displayName}</span>
                <InlinePending active={isBusy} />
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)} ·{' '}
                {formatDate(document.updatedAt)}
              </p>
              {linkBadges.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                  {linkBadges[0]}
                  {linkBadges.length > 1 ? ` +${linkBadges.length - 1}` : ''}
                </p>
              )}
            </div>
          </div>
          <div onClick={(event) => event.stopPropagation()}>
            <DocumentActionsMenu
              document={document}
              isTrashView={isTrashView}
              disabled={isBusy}
              handlers={handlers}
            />
          </div>
        </ListRow>
      </ContextMenuTrigger>
      <DocumentContextMenuContent document={document} isTrashView={isTrashView} handlers={handlers} />
    </ContextMenu>
  );
}

type DocumentLibraryMobileListProps = {
  folders: DocumentFolder[];
  documents: OrganizationDocument[];
  selectedFolderIds: Set<string>;
  selectedDocumentIds: Set<string>;
  isTrashView: boolean;
  searchQuery: string;
  isItemBusy: (itemId: string) => boolean;
  rowActions: DocumentLibraryRowActions;
  onToggleFolderSelection: (folderId: string) => void;
  onToggleDocumentSelection: (documentId: string) => void;
};

/** The library's folders and documents as cards below the tablet breakpoint. */
export function DocumentLibraryMobileList({
  folders,
  documents,
  selectedFolderIds,
  selectedDocumentIds,
  isTrashView,
  searchQuery,
  isItemBusy,
  rowActions,
  onToggleFolderSelection,
  onToggleDocumentSelection,
}: DocumentLibraryMobileListProps) {
  return (
    <div className="space-y-2 md:hidden">
      {folders.map((folder) => (
        <DocumentLibraryFolderCard
          key={folder.id}
          folder={folder}
          isSelected={selectedFolderIds.has(folder.id)}
          isBusy={isItemBusy(folder.id)}
          rowActions={rowActions}
          onToggleSelection={onToggleFolderSelection}
        />
      ))}

      {documents.map((document) => (
        <DocumentLibraryDocumentCard
          key={document.id}
          document={document}
          isSelected={selectedDocumentIds.has(document.id)}
          isBusy={isItemBusy(document.id)}
          isTrashView={isTrashView}
          rowActions={rowActions}
          onToggleSelection={onToggleDocumentSelection}
        />
      ))}

      {folders.length === 0 && documents.length === 0 && (
        <DocumentLibraryEmptyState searchQuery={searchQuery} />
      )}
    </div>
  );
}

/** The library's empty state on every viewport: an empty source, or a search without a match. */
export function DocumentLibraryEmptyState({ searchQuery }: { searchQuery: string }): ReactElement {
  return (
    <EmptyState
      title={searchQuery ? 'Keine Dokumente gefunden' : 'Noch keine Dokumente'}
      description={
        searchQuery
          ? 'Zu deiner Suche gibt es kein Dokument. Ändere die Suche oder die Filter.'
          : 'Lade Dateien über „Hochladen oder Erstellen“ hoch oder ziehe sie in dieses Fenster.'
      }
    />
  );
}
