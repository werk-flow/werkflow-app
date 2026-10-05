'use client';

import type { ReactElement } from 'react';
import { Download, LinkIcon, MoreHorizontal, Pencil, Trash2, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { OrganizationDocument } from '@/lib/documents/types';
import {
  getContextLink,
  getUnlinkLabel,
  type ContextualDocumentLinkContext,
} from './contextual-documents-context';

export type ContextualDocumentRowMenuProps = {
  document: OrganizationDocument;
  /** This row's own action is in flight; the other rows stay usable. */
  isBusy: boolean;
  canManage: boolean;
  context: ContextualDocumentLinkContext;
  onOpen: (document: OrganizationDocument) => void;
  onManageLinks: (document: OrganizationDocument) => void;
  onRename: (document: OrganizationDocument) => void;
  /** Receives the row's own context link, which a job group row resolves from its job. */
  onUnlink: (document: OrganizationDocument, linkId: string) => void;
  onDelete: (document: OrganizationDocument) => void;
};

/** The action menu of one document row in a contextual document list. */
export function ContextualDocumentRowMenu({
  document,
  isBusy,
  canManage,
  context,
  onOpen,
  onManageLinks,
  onRename,
  onUnlink,
  onDelete,
}: ContextualDocumentRowMenuProps): ReactElement {
  const contextLink = getContextLink(document, context);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={isBusy} className="shrink-0">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Dateiaktionen öffnen</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onOpen(document)}>
          <Download className="size-4" />
          Öffnen
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem onClick={() => onManageLinks(document)}>
              <LinkIcon className="size-4" />
              Verknüpfungen verwalten
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRename(document)}>
              <Pencil className="size-4" />
              Umbenennen
            </DropdownMenuItem>
            {contextLink && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onUnlink(document, contextLink.id)}>
                  <Unlink className="size-4" />
                  {getUnlinkLabel(context)}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(document)}>
              <Trash2 className="size-4" />
              In Papierkorb verschieben
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
