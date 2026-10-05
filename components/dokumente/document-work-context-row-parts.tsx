'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { formatGermanDate as formatDate } from '@/lib/utils';
import { formatFileSize } from '@/lib/documents/format';
import type { MouseEvent, ReactElement } from 'react';
import Link from 'next/link';
import {
  ExternalLink,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { TableCell, TableRow } from '@/components/ui/table';
import { DOCUMENT_CATEGORY_LABELS, type OrganizationDocument } from '@/lib/documents/types';
import { cn } from '@/lib/utils';
import { DocumentActionsMenu, DocumentContextMenuContent } from './document-row-actions';

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

/** What every group of the work-context view needs to expand and render its documents. */
export type WorkContextGroupProps = {
  rowId: string;
  isExpanded: boolean;
  onToggle: (rowId: string, event?: MouseEvent<HTMLButtonElement>) => void;
  isDocumentPending: (documentId: string) => boolean;
  getHandlers: (document: OrganizationDocument) => DocumentActionHandlers;
};

function renderFileIcon(document: OrganizationDocument): ReactElement {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();
  const className = 'size-4 shrink-0 text-muted-foreground';

  if (mimeType.startsWith('image/')) return <FileImage className={className} />;
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return <FileText className={className} />;
  }
  if (mimeType.includes('spreadsheet') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
    return <FileSpreadsheet className={className} />;
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return <FileArchive className={className} />;
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return <FileType className={className} />;
  }
  return <File className={className} />;
}

export function OpenContextLink({
  href,
  label,
}: {
  href: string | null;
  label: string;
}): ReactElement | null {
  if (!href) return null;

  return (
    <Button asChild size="sm" variant="ghost" className="h-7 px-2">
      <Link href={href} onClick={(event) => event.stopPropagation()}>
        <ExternalLink className="size-3.5" />
        {label}
      </Link>
    </Button>
  );
}

export function DocumentSummary({
  count,
  latestUpdatedAt,
}: {
  count: number;
  latestUpdatedAt: string | null;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Badge variant="secondary">
        {count} {count === 1 ? 'Datei' : 'Dateien'}
      </Badge>
      {latestUpdatedAt && <span>Zuletzt aktualisiert am {formatDate(latestUpdatedAt)}</span>}
    </div>
  );
}

export function DocumentInlineRow({
  document,
  indent = 'none',
  isPending,
  handlers,
}: {
  document: OrganizationDocument;
  indent?: 'none' | 'project' | 'job';
  isPending: boolean;
  handlers: DocumentActionHandlers;
}): ReactElement {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <TableRow interactive className="bg-background" onClick={() => handlers.onOpen()}>
          <TableCell className="w-[44px]" />
          <TableCell
            className={cn('font-medium', indent === 'project' && 'pl-10', indent === 'job' && 'pl-16')}
          >
            <div className="flex min-w-0 items-center gap-2">
              {renderFileIcon(document)}
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm">
                  <span className="truncate">{document.displayName}</span>
                  <InlinePending active={isPending} />
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)}
                </p>
              </div>
            </div>
          </TableCell>
          <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">Datei</TableCell>
          <TableCell className="text-sm text-muted-foreground">{formatDate(document.updatedAt)}</TableCell>
          <TableCell className="w-[52px]" onClick={(event) => event.stopPropagation()}>
            <DocumentActionsMenu
              document={document}
              isTrashView={false}
              disabled={isPending}
              handlers={handlers}
            />
          </TableCell>
        </TableRow>
      </ContextMenuTrigger>
      <DocumentContextMenuContent document={document} isTrashView={false} handlers={handlers} />
    </ContextMenu>
  );
}

export function MobileDocumentCard({
  document,
  isPending,
  handlers,
}: {
  document: OrganizationDocument;
  isPending: boolean;
  handlers: DocumentActionHandlers;
}): ReactElement {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <ListRow interactive onClick={() => handlers.onOpen()}>
          <div className="flex min-w-0 items-center gap-2">
            {renderFileIcon(document)}
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                <PlainButton
                  type="button"
                  className="truncate rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    handlers.onOpen();
                  }}
                >
                  {document.displayName}
                </PlainButton>
                <InlinePending active={isPending} />
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {DOCUMENT_CATEGORY_LABELS[document.category]} · {formatFileSize(document.sizeBytes)} ·{' '}
                {formatDate(document.updatedAt)}
              </p>
            </div>
          </div>
          <div onClick={(event) => event.stopPropagation()}>
            <DocumentActionsMenu
              document={document}
              isTrashView={false}
              disabled={isPending}
              handlers={handlers}
            />
          </div>
        </ListRow>
      </ContextMenuTrigger>
      <DocumentContextMenuContent document={document} isTrashView={false} handlers={handlers} />
    </ContextMenu>
  );
}
