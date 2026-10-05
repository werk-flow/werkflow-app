'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { formatGermanDate as formatDate } from '@/lib/utils';
import { formatFileSize } from '@/lib/documents/format';
import {
  createElement,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { Folder } from 'lucide-react';

import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { InlinePending } from '@/components/ui/inline-pending';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import {
  DocumentActionsMenu,
  DocumentContextMenuContent,
  FolderActionsMenu,
  FolderContextMenuContent,
  MultiSelectionContextMenuContent,
} from './document-row-actions';
import {
  getFileIcon,
  getFileTypeLabel,
  getLinkBadges,
  getUploaderName,
  getUserDisplayName,
} from './document-library-file-labels';
import { SelectionCircle } from './document-library-table-selection-circle';

// State tints layered on top of the `select` interaction: the row's hover
// itself comes only from `interactive="select"`. A selected row keeps its
// tint under the pointer; a row being dragged stops reacting to it.
const SELECTED_ROW_CLASS = 'bg-primary/10 hover:bg-primary/15';
const DRAGGED_ROW_CLASS = 'cursor-not-allowed opacity-45 saturate-50 hover:bg-transparent';

export type DocumentActionHandlers = {
  onOpen: () => void;
  onDetails: () => void;
  onRename: () => void;
  onLink: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
};

export type FolderActionHandlers = {
  onOpen: () => void;
  onMove: () => void;
  onCopy: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function handleRowContextMenu(event: MouseEvent<HTMLTableRowElement>): void {
  event.stopPropagation();
}

/** What a folder row and a document row share: selection, pending and drag wiring. */
export type DocumentLibraryTableRowProps = {
  isSelected: boolean;
  /** More than one visible row is selected: a selected row offers the batch menu. */
  hasMultiSelection: boolean;
  isPending: boolean;
  isItemPending: boolean;
  rowRef: (node: HTMLTableRowElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLTableRowElement>) => void;
  onSelectionClick: (event: MouseEvent<HTMLTableRowElement>) => void;
  onToggleSelection: () => void;
  onClearSelection: () => void;
  /** Opening the row menu of a row outside a multi-selection selects only that row. */
  onActionsMenuOpenChange: () => void;
  onBatchMoveSelection: () => void;
  onBatchCopySelection: () => void;
  onBatchDeleteSelection: () => void;
};

export function DocumentLibraryTableFolderRow({
  folder,
  isDropTarget,
  handlers,
  isSelected,
  hasMultiSelection,
  isPending,
  isItemPending,
  rowRef,
  onPointerDown,
  onSelectionClick,
  onToggleSelection,
  onClearSelection,
  onActionsMenuOpenChange,
  onBatchMoveSelection,
  onBatchCopySelection,
  onBatchDeleteSelection,
}: DocumentLibraryTableRowProps & {
  folder: DocumentFolder;
  isDropTarget: boolean;
  handlers: FolderActionHandlers;
}): ReactElement {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <TableRow
          ref={rowRef}
          data-state={isSelected ? 'selected' : undefined}
          data-document-selection-preserve="true"
          data-document-table-folder-drop-id={folder.id}
          interactive="select"
          className={cn(
            isSelected && SELECTED_ROW_CLASS,
            isDropTarget && 'bg-primary/20 outline outline-1 outline-primary/60',
          )}
          onPointerDown={onPointerDown}
          onClick={onSelectionClick}
          onDoubleClick={() => handlers.onOpen()}
          onContextMenu={handleRowContextMenu}
        >
          <TableCell>
            <SelectionCircle
              checked={isSelected}
              label={`Ordner ${folder.name} auswählen`}
              onClick={onToggleSelection}
            />
          </TableCell>
          <TableCell>
            <PlainButton
              type="button"
              data-table-interactive="true"
              className="flex min-w-0 items-center gap-2 font-medium text-left hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                onClearSelection();
                handlers.onOpen();
              }}
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{folder.name}</span>
              <InlinePending active={isItemPending} />
            </PlainButton>
          </TableCell>
          <TableCell className="hidden text-muted-foreground md:table-cell">
            {getUserDisplayName(folder.creator)}
          </TableCell>
          <TableCell className="hidden text-muted-foreground sm:table-cell">
            {formatDate(folder.createdAt)}
          </TableCell>
          <TableCell className="hidden text-muted-foreground sm:table-cell">-</TableCell>
          <TableCell className="hidden text-muted-foreground lg:table-cell">Ordner</TableCell>
          <TableCell className="hidden text-muted-foreground xl:table-cell">-</TableCell>
          <TableCell data-table-interactive="true">
            <FolderActionsMenu
              folder={folder}
              disabled={isPending || isItemPending}
              handlers={handlers}
              onOpenChange={onActionsMenuOpenChange}
            />
          </TableCell>
        </TableRow>
      </ContextMenuTrigger>
      {hasMultiSelection && isSelected ? (
        <MultiSelectionContextMenuContent
          onMove={onBatchMoveSelection}
          onCopy={onBatchCopySelection}
          onDelete={onBatchDeleteSelection}
        />
      ) : (
        <FolderContextMenuContent folder={folder} handlers={handlers} />
      )}
    </ContextMenu>
  );
}

export function DocumentLibraryTableDocumentRow({
  document,
  isTrashView,
  isDragActive,
  handlers,
  isSelected,
  hasMultiSelection,
  isPending,
  isItemPending,
  rowRef,
  onPointerDown,
  onSelectionClick,
  onToggleSelection,
  onClearSelection,
  onActionsMenuOpenChange,
  onBatchMoveSelection,
  onBatchCopySelection,
  onBatchDeleteSelection,
}: DocumentLibraryTableRowProps & {
  document: OrganizationDocument;
  isTrashView: boolean;
  /** Any row is being dragged: document rows are no drop target and dim. */
  isDragActive: boolean;
  handlers: DocumentActionHandlers;
}): ReactElement {
  const linkBadges = getLinkBadges(document);

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <TableRow
          ref={rowRef}
          data-state={isSelected ? 'selected' : undefined}
          data-document-selection-preserve="true"
          interactive="select"
          className={cn(isSelected && SELECTED_ROW_CLASS, isDragActive && DRAGGED_ROW_CLASS)}
          onPointerDown={onPointerDown}
          onClick={onSelectionClick}
          onDoubleClick={() => handlers.onOpen()}
          onContextMenu={handleRowContextMenu}
        >
          <TableCell>
            <SelectionCircle
              checked={isSelected}
              label={`Datei ${document.displayName} auswählen`}
              onClick={onToggleSelection}
            />
          </TableCell>
          <TableCell>
            <PlainButton
              type="button"
              data-table-interactive="true"
              className="flex min-w-0 items-center gap-2 font-medium text-left hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                onClearSelection();
                handlers.onOpen();
              }}
            >
              {createElement(getFileIcon(document), {
                className: 'size-4 shrink-0 text-muted-foreground',
              })}
              <span className="truncate">{document.displayName}</span>
              <InlinePending active={isItemPending} />
            </PlainButton>
          </TableCell>
          <TableCell className="hidden text-muted-foreground md:table-cell">
            {getUploaderName(document)}
          </TableCell>
          <TableCell className="hidden text-muted-foreground sm:table-cell">
            {formatDate(document.updatedAt)}
          </TableCell>
          <TableCell className="hidden text-muted-foreground sm:table-cell">
            {formatFileSize(document.sizeBytes)}
          </TableCell>
          <TableCell className="hidden text-muted-foreground lg:table-cell">
            {getFileTypeLabel(document)}
          </TableCell>
          <TableCell className="hidden xl:table-cell">
            {linkBadges.length === 0 ? (
              <span className="text-muted-foreground">-</span>
            ) : (
              <div className="flex max-w-64 flex-wrap gap-1">
                {linkBadges.slice(0, 2).map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary-foreground"
                  >
                    {badge}
                  </span>
                ))}
                {linkBadges.length > 2 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    +{linkBadges.length - 2}
                  </span>
                )}
              </div>
            )}
          </TableCell>
          <TableCell data-table-interactive="true">
            <DocumentActionsMenu
              document={document}
              isTrashView={isTrashView}
              disabled={isPending || isItemPending}
              handlers={handlers}
              onOpenChange={onActionsMenuOpenChange}
            />
          </TableCell>
        </TableRow>
      </ContextMenuTrigger>
      {hasMultiSelection && isSelected ? (
        <MultiSelectionContextMenuContent
          onMove={onBatchMoveSelection}
          onCopy={onBatchCopySelection}
          onDelete={onBatchDeleteSelection}
        />
      ) : (
        <DocumentContextMenuContent document={document} isTrashView={isTrashView} handlers={handlers} />
      )}
    </ContextMenu>
  );
}
