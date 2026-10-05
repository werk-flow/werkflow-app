'use client';

import { Copy, MoveRight, Trash2, Undo2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

type DocumentLibrarySelectionActionsProps = {
  selectedItemCount: number;
  isTrashView: boolean;
  isBusy: boolean;
  /** The restore button needs at least one selected document. */
  canRestore: boolean;
  onClearSelection: () => void;
  onRestore: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

/** Count and batch actions for the selected rows, shown beside the search field. */
export function DocumentLibrarySelectionActions({
  selectedItemCount,
  isTrashView,
  isBusy,
  canRestore,
  onClearSelection,
  onRestore,
  onMove,
  onCopy,
  onDelete,
}: DocumentLibrarySelectionActionsProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 text-sm">
      <div className="flex h-9 items-center gap-1 rounded-full border bg-muted/50 px-2 text-muted-foreground">
        <Button type="button" variant="ghost" size="icon-sm" className="size-6" onClick={onClearSelection}>
          <X className="size-4" />
          <span className="sr-only">Auswahl aufheben</span>
        </Button>
        <span className="whitespace-nowrap font-medium text-foreground">{selectedItemCount} ausgewählt</span>
      </div>
      {isTrashView ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-9 rounded-md"
          onClick={onRestore}
          disabled={isBusy || !canRestore}
        >
          <Undo2 className="size-4" />
          <span className="sr-only">Wiederherstellen</span>
        </Button>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-9 rounded-md"
            onClick={onMove}
            disabled={isBusy}
          >
            <MoveRight className="size-4" />
            <span className="sr-only">Verschieben</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-9 rounded-md"
            onClick={onCopy}
            disabled={isBusy}
          >
            <Copy className="size-4" />
            <span className="sr-only">Kopieren</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-9 rounded-md text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isBusy}
          >
            <Trash2 className="size-4" />
            <span className="sr-only">Löschen</span>
          </Button>
        </>
      )}
    </div>
  );
}
