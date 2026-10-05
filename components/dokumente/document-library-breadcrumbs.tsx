'use client';

import type { DragEvent } from 'react';
import Link from 'next/link';

import type { DocumentFolder } from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import { getFolderHref, shouldUseDefaultLinkBehavior } from './document-library-links';

type DocumentLibraryBreadcrumbsProps = {
  currentFolderId: string | null;
  breadcrumbs: DocumentFolder[];
  /** The breadcrumb a dragged row hovers over: a folder id or "root". */
  dropTargetId: string | null;
  onNavigateToFolder: (folderId: string | null) => void;
  onDragOverFolder: (event: DragEvent<HTMLElement>, targetFolderId: string | null) => void;
  onDragLeaveFolder: () => void;
  onDropOnFolder: (event: DragEvent<HTMLElement>, targetFolderId: string | null) => void;
};

/** Folder path of the library; every crumb navigates and accepts dragged rows. */
export function DocumentLibraryBreadcrumbs({
  currentFolderId,
  breadcrumbs,
  dropTargetId,
  onNavigateToFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}: DocumentLibraryBreadcrumbsProps) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <Link
        href="/dokumente?view=folders"
        data-document-breadcrumb-folder-drop-id="root"
        className={cn(
          'rounded border border-transparent px-2 py-1 transition-colors hover:bg-accent hover:text-foreground',
          !currentFolderId && 'bg-accent text-foreground cursor-not-allowed',
          dropTargetId === 'root' && 'border-primary bg-primary/10 text-foreground',
        )}
        onClick={(event) => {
          if (shouldUseDefaultLinkBehavior(event)) return;
          event.preventDefault();
          onNavigateToFolder(null);
        }}
        onDragOver={(event) => onDragOverFolder(event, null)}
        onDragEnter={(event) => onDragOverFolder(event, null)}
        onDragLeave={onDragLeaveFolder}
        onDrop={(event) => onDropOnFolder(event, null)}
      >
        Dokumente
      </Link>
      {breadcrumbs.map((folder) => (
        <span key={folder.id} className="flex items-center gap-1">
          <span>/</span>
          <Link
            href={getFolderHref(folder.id)}
            data-document-breadcrumb-folder-drop-id={folder.id}
            className={cn(
              'rounded border border-transparent px-2 py-1 transition-colors hover:bg-accent hover:text-foreground',
              currentFolderId === folder.id && 'bg-accent text-foreground cursor-not-allowed',
              dropTargetId === folder.id && 'border-primary bg-primary/10 text-foreground',
            )}
            onClick={(event) => {
              if (shouldUseDefaultLinkBehavior(event)) return;
              event.preventDefault();
              onNavigateToFolder(folder.id);
            }}
            onDragOver={(event) => onDragOverFolder(event, folder.id)}
            onDragEnter={(event) => onDragOverFolder(event, folder.id)}
            onDragLeave={onDragLeaveFolder}
            onDrop={(event) => onDropOnFolder(event, folder.id)}
          >
            {folder.name}
          </Link>
        </span>
      ))}
    </nav>
  );
}
