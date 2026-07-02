'use client';

import {
  BadgeInfo,
  Copy,
  Download,
  FolderOpen,
  LinkIcon,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';

type DocumentActionHandlers = {
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

type FolderActionHandlers = {
  onOpen: () => void;
  onMove: () => void;
  onCopy: () => void;
  onRename: () => void;
  onDelete: () => void;
};

type DocumentActionsProps = {
  document: OrganizationDocument;
  isTrashView: boolean;
  disabled?: boolean;
  handlers: DocumentActionHandlers;
  onOpenChange?: () => void;
};

type FolderActionsProps = {
  folder: DocumentFolder;
  disabled?: boolean;
  handlers: FolderActionHandlers;
  onOpenChange?: () => void;
};

type MultiSelectionContextMenuProps = {
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

function DocumentActionItems({
  isTrashView,
  handlers,
  item: Item,
  separator: Separator,
}: {
  isTrashView: boolean;
  handlers: DocumentActionHandlers;
  item: typeof DropdownMenuItem | typeof ContextMenuItem;
  separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
}) {
  const MenuItem = Item;
  const MenuSeparator = Separator;

  return (
    <>
      <MenuItem onClick={handlers.onOpen}>
        <Download className="size-4" />
        Öffnen
      </MenuItem>
      <MenuItem onClick={handlers.onDetails}>
        <BadgeInfo className="size-4" />
        Details
      </MenuItem>
      {isTrashView ? (
        <>
          <MenuItem onClick={handlers.onRestore}>
            <Undo2 className="size-4" />
            Wiederherstellen
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={handlers.onPermanentDelete}>
            <Trash2 className="size-4" />
            Endgültig löschen
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem onClick={handlers.onRename}>
            <Pencil className="size-4" />
            Umbenennen
          </MenuItem>
          <MenuItem onClick={handlers.onLink}>
            <LinkIcon className="size-4" />
            Verknüpfungen verwalten
          </MenuItem>
          <MenuItem onClick={handlers.onMove}>
            <MoveRight className="size-4" />
            Verschieben
          </MenuItem>
          <MenuItem onClick={handlers.onCopy}>
            <Copy className="size-4" />
            Kopieren
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={handlers.onDelete}>
            <Trash2 className="size-4" />
            Löschen
          </MenuItem>
        </>
      )}
    </>
  );
}

function FolderActionItems({
  handlers,
  item: Item,
  separator: Separator,
}: {
  handlers: FolderActionHandlers;
  item: typeof DropdownMenuItem | typeof ContextMenuItem;
  separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
}) {
  const MenuItem = Item;
  const MenuSeparator = Separator;

  return (
    <>
      <MenuItem onClick={handlers.onOpen}>
        <FolderOpen className="size-4" />
        Öffnen
      </MenuItem>
      <MenuItem onClick={handlers.onRename}>
        <Pencil className="size-4" />
        Umbenennen
      </MenuItem>
      <MenuItem onClick={handlers.onMove}>
        <MoveRight className="size-4" />
        Verschieben
      </MenuItem>
      <MenuItem onClick={handlers.onCopy}>
        <Copy className="size-4" />
        Kopieren
      </MenuItem>
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={handlers.onDelete}>
        <Trash2 className="size-4" />
        Löschen
      </MenuItem>
    </>
  );
}

export function DocumentActionsMenu({
  document,
  isTrashView,
  disabled,
  handlers,
  onOpenChange,
}: DocumentActionsProps) {
  return (
    <DropdownMenu onOpenChange={(open) => open && onOpenChange?.()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Dateiaktionen für {document.displayName} öffnen</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DocumentActionItems
          isTrashView={isTrashView}
          handlers={handlers}
          item={DropdownMenuItem}
          separator={DropdownMenuSeparator}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DocumentContextMenuContent({
  isTrashView,
  handlers,
}: DocumentActionsProps) {
  return (
    <ContextMenuContent>
      <DocumentActionItems
        isTrashView={isTrashView}
        handlers={handlers}
        item={ContextMenuItem}
        separator={ContextMenuSeparator}
      />
    </ContextMenuContent>
  );
}

export function FolderActionsMenu({
  folder,
  disabled,
  handlers,
  onOpenChange,
}: FolderActionsProps) {
  return (
    <DropdownMenu onOpenChange={(open) => open && onOpenChange?.()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Ordneraktionen für {folder.name} öffnen</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <FolderActionItems
          handlers={handlers}
          item={DropdownMenuItem}
          separator={DropdownMenuSeparator}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FolderContextMenuContent({ handlers }: FolderActionsProps) {
  return (
    <ContextMenuContent>
      <FolderActionItems
        handlers={handlers}
        item={ContextMenuItem}
        separator={ContextMenuSeparator}
      />
    </ContextMenuContent>
  );
}

export function MultiSelectionContextMenuContent({
  onMove,
  onCopy,
  onDelete,
}: MultiSelectionContextMenuProps) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onMove}>
        <MoveRight className="size-4" />
        Verschieben
      </ContextMenuItem>
      <ContextMenuItem onClick={onCopy}>
        <Copy className="size-4" />
        Kopieren
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 className="size-4" />
        Löschen
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
