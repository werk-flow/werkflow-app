'use client';

import { createElement, type ReactNode } from 'react';
import { ChevronRight, Folder, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { PlainButton } from '@/components/ui/plain-button';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import { cn, formatGermanDate as formatDate } from '@/lib/utils';
import { getFileIcon, getFileTypeLabel } from './document-library-file-labels';

/** The regions of the move/copy destination dialog: sidebar, breadcrumbs, rows and footer. */

export type MoveDestinationMode = 'move' | 'copy';

function renderSelectedItemPill(label: ReactNode): ReactNode {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

type MoveDestinationSidebarProps = {
  mode: MoveDestinationMode;
  currentFolderId: string | null;
  selectedDocuments: OrganizationDocument[];
  selectedFolders: DocumentFolder[];
  onSelectFolder: (folderId: string | null) => void;
};

export function MoveDestinationSidebar({
  mode,
  currentFolderId,
  selectedDocuments,
  selectedFolders,
  onSelectFolder,
}: MoveDestinationSidebarProps) {
  return (
    <aside className="hidden border-r bg-background/80 p-4 text-sm lg:block">
      <p className="font-medium">{mode === 'copy' ? 'Kopieren nach' : 'Verschieben nach'}</p>
      <div className="mt-4 space-y-2 text-muted-foreground">
        <PlainButton
          type="button"
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted hover:text-foreground',
            currentFolderId === null && 'bg-muted text-foreground',
          )}
          onClick={() => onSelectFolder(null)}
        >
          <Folder className="size-4" />
          Dokumente
        </PlainButton>
        <p className="px-2 pt-3 text-xs font-medium uppercase tracking-wide">Auswahl</p>
        <div className="flex flex-wrap gap-1 px-2">
          {selectedFolders.length > 0 &&
            renderSelectedItemPill(
              selectedFolders.length === 1 ? '1 Ordner' : `${selectedFolders.length} Ordner`,
            )}
          {selectedDocuments.length > 0 &&
            renderSelectedItemPill(
              selectedDocuments.length === 1 ? '1 Dokument' : `${selectedDocuments.length} Dokumente`,
            )}
        </div>
      </div>
    </aside>
  );
}

type MoveDestinationBreadcrumbsProps = {
  currentFolderId: string | null;
  breadcrumbFolders: DocumentFolder[];
  onSelectFolder: (folderId: string | null) => void;
};

export function MoveDestinationBreadcrumbs({
  currentFolderId,
  breadcrumbFolders,
  onSelectFolder,
}: MoveDestinationBreadcrumbsProps) {
  return (
    <div className="flex min-h-12 items-center gap-1 border-b bg-background px-4 text-sm">
      <PlainButton
        type="button"
        className={cn(
          'rounded-md px-2 py-1 font-medium transition-colors hover:bg-muted',
          currentFolderId === null && 'bg-muted',
        )}
        onClick={() => onSelectFolder(null)}
      >
        Dokumente
      </PlainButton>
      {breadcrumbFolders.map((folder) => (
        <div key={folder.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          <PlainButton
            type="button"
            className={cn(
              'truncate rounded-md px-2 py-1 font-medium transition-colors hover:bg-muted',
              folder.id === currentFolderId && 'bg-muted',
            )}
            onClick={() => onSelectFolder(folder.id)}
          >
            {folder.name}
          </PlainButton>
        </div>
      ))}
    </div>
  );
}

type MoveDestinationFolderRowProps = {
  folder: DocumentFolder;
  isDisabled: boolean;
  onSelectFolder: (folderId: string | null) => void;
};

export function MoveDestinationFolderRow({
  folder,
  isDisabled,
  onSelectFolder,
}: MoveDestinationFolderRowProps) {
  return (
    <div
      className={cn(
        'grid w-full grid-cols-[minmax(0,1fr)] items-center px-4 py-3 text-left text-sm transition-colors hover:bg-muted/70 sm:grid-cols-[minmax(0,1fr)_140px_160px]',
        isDisabled && 'cursor-not-allowed',
      )}
      onDoubleClick={() => {
        if (!isDisabled) onSelectFolder(folder.id);
      }}
    >
      <span className={cn('flex min-w-0 items-center gap-2 font-medium', isDisabled && 'opacity-45')}>
        <Folder className="size-4 shrink-0 text-primary" />
        <PlainButton
          type="button"
          className="truncate text-left hover:underline"
          onClick={() => {
            if (!isDisabled) onSelectFolder(folder.id);
          }}
          disabled={isDisabled}
        >
          {folder.name}
        </PlainButton>
      </span>
      <span className={cn('hidden text-muted-foreground sm:inline', isDisabled && 'opacity-45')}>Ordner</span>
      <span className={cn('hidden text-muted-foreground sm:inline', isDisabled && 'opacity-45')}>
        {formatDate(folder.updatedAt)}
      </span>
    </div>
  );
}

type MoveDestinationDocumentRowProps = {
  document: OrganizationDocument;
  isSelected: boolean;
  onOpenDocument: (document: OrganizationDocument) => void;
};

export function MoveDestinationDocumentRow({
  document,
  isSelected,
  onOpenDocument,
}: MoveDestinationDocumentRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)] items-center px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_140px_160px]',
        isSelected ? 'bg-muted/70 text-muted-foreground opacity-60' : 'text-muted-foreground',
      )}
      onDoubleClick={() => onOpenDocument(document)}
    >
      <span className="flex min-w-0 items-center gap-2">
        {createElement(getFileIcon(document), { className: 'size-4 shrink-0' })}
        <PlainButton
          type="button"
          className="truncate text-left hover:underline"
          onClick={() => onOpenDocument(document)}
        >
          {document.displayName}
        </PlainButton>
      </span>
      <span className="hidden sm:inline">{getFileTypeLabel(document)}</span>
      <span className="hidden sm:inline">{formatDate(document.updatedAt)}</span>
    </div>
  );
}

type MoveDestinationFooterProps = {
  mode: MoveDestinationMode;
  isPending: boolean;
  progress: number | null;
  error: string | null;
  disabledReason: string | null;
  confirmDisabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MoveDestinationFooter({
  mode,
  isPending,
  progress,
  error,
  disabledReason,
  confirmDisabled,
  onCancel,
  onConfirm,
}: MoveDestinationFooterProps) {
  return (
    <div className="flex flex-col gap-3 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      {progress !== null ? (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={mode === 'copy' ? 'Fortschritt beim Kopieren' : 'Fortschritt beim Verschieben'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-sm text-muted-foreground">{progress} %</span>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="min-h-5 text-sm text-muted-foreground">
            {disabledReason ?? 'Wähle den Zielordner und bestätige den Vorgang.'}
          </p>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <div className="flex shrink-0 justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Abbrechen
        </Button>
        <Button type="button" onClick={onConfirm} disabled={confirmDisabled}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {mode === 'copy' ? 'Hierhin kopieren' : 'Hierhin verschieben'}
        </Button>
      </div>
    </div>
  );
}
