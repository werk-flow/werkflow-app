'use client';

import type { DragEvent } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import type {
  DocumentLibraryCategoryFilter,
  DocumentLibraryLinkFilter,
  DocumentLibraryView,
} from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import { hasInternalRowDrag } from './document-drop-entries';
import { getViewHref, shouldUseDefaultLinkBehavior } from './document-library-links';
import type { DocumentLocationTarget } from './use-document-library-navigation';

const primaryViewOptions: Array<{
  value: DocumentLibraryView;
  label: string;
}> = [
  { value: 'folders', label: 'Dokumente' },
  { value: 'work', label: 'Verknüpfungen' },
  { value: 'all', label: 'Alle Dateien' },
];

type DocumentLibraryViewSwitchProps = {
  visibleView: DocumentLibraryView;
  searchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  /** A document action is running: the trash button shows it. */
  isMutating: boolean;
  isNavigationPending: boolean;
  isTrashDragOver: boolean;
  onNavigate: (target: DocumentLocationTarget) => void;
  onTrashDragOverChange: (isOver: boolean) => void;
  onTrashDrop: (event: DragEvent<HTMLButtonElement>) => void;
};

/** The library's view buttons and the trash button, which is also a drop target for rows. */
export function DocumentLibraryViewSwitch({
  visibleView,
  searchQuery,
  category,
  linkFilter,
  isMutating,
  isNavigationPending,
  isTrashDragOver,
  onNavigate,
  onTrashDragOverChange,
  onTrashDrop,
}: DocumentLibraryViewSwitchProps) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap gap-2">
        {primaryViewOptions.map((option) => (
          <Button
            key={option.value}
            asChild
            size="sm"
            variant={visibleView === option.value ? 'secondary' : 'outline'}
            className="min-w-32"
          >
            <Link
              href={getViewHref({
                view: option.value,
                searchQuery,
                category,
                linkFilter,
              })}
              onClick={(event) => {
                if (shouldUseDefaultLinkBehavior(event)) return;
                event.preventDefault();
                onNavigate({
                  href: getViewHref({
                    view: option.value,
                    searchQuery,
                    category,
                    linkFilter,
                  }),
                  targetView: option.value,
                  targetFolderId: null,
                });
              }}
            >
              {option.label}
            </Link>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={visibleView === 'trash' ? 'secondary' : 'outline'}
          data-document-trash-drop="true"
          disabled={isMutating || isNavigationPending}
          className={cn(
            'min-w-32',
            isTrashDragOver && 'border-destructive text-destructive ring-2 ring-destructive/30',
          )}
          onClick={() => {
            onNavigate({
              href: getViewHref({
                view: 'trash',
                searchQuery,
              }),
              targetView: 'trash',
              targetFolderId: null,
            });
          }}
          onDragOver={(event) => {
            if (!hasInternalRowDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            onTrashDragOverChange(true);
          }}
          onDragEnter={(event) => {
            if (!hasInternalRowDrag(event.dataTransfer)) return;
            event.preventDefault();
            onTrashDragOverChange(true);
          }}
          onDragLeave={() => onTrashDragOverChange(false)}
          onDrop={onTrashDrop}
        >
          {isMutating ? (
            <InlinePending active label="Dokumentaktion wird ausgeführt" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Papierkorb
        </Button>
      </div>
    </div>
  );
}
