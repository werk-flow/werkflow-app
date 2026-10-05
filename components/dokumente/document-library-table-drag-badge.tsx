'use client';

import type { ReactElement } from 'react';
import { File, Folder } from 'lucide-react';

import { getFileIcon } from './document-library-file-labels';
import {
  getDragSelectionLabel,
  type DocumentLibraryTableItem,
  type DocumentTableDragSelection,
} from './document-library-table-items';

type DocumentLibraryTableDragBadgeProps = {
  draggedItem: DocumentLibraryTableItem;
  draggedSelection: DocumentTableDragSelection;
  dragPosition: { x: number; y: number };
};

/** The pill that follows the pointer while rows are dragged. */
export function DocumentLibraryTableDragBadge({
  draggedItem,
  draggedSelection,
  dragPosition,
}: DocumentLibraryTableDragBadgeProps): ReactElement {
  return (
    <div
      className="pointer-events-none fixed z-50 inline-flex max-w-70 items-center gap-1.5 truncate rounded-full border bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-lg"
      style={{
        left: dragPosition.x + 14,
        top: dragPosition.y + 14,
      }}
    >
      {draggedSelection.folderIds.length > 0 && <Folder className="size-3.5 shrink-0" />}
      {draggedSelection.documentIds.length > 0 &&
        (draggedSelection.folderIds.length > 0 ? (
          <File className="size-3.5 shrink-0" />
        ) : draggedItem.kind === 'document' ? (
          (() => {
            const DragIcon = getFileIcon(draggedItem.document);
            return <DragIcon className="size-3.5 shrink-0" />;
          })()
        ) : (
          <File className="size-3.5 shrink-0" />
        ))}
      <span className="truncate">{getDragSelectionLabel(draggedSelection)}</span>
    </div>
  );
}
