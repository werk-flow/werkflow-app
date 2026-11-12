'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, MoreHorizontal, ExternalLink, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EditClientDialog } from './edit-client-dialog';
import type { ClientRemoval } from './client-removal-dialog';
import type { Client } from '@/lib/jobs/types';

/** What a row of the customer list can do beyond opening and editing. */
export type ClientRowActions = {
  /** The list shows archived customers: a row offers restoring instead of archiving. */
  isArchivedView: boolean;
  /** An edit was confirmed by the server; the list keeps the row marked until props land. */
  onSaved: (clientId: string) => void;
  /** Opens the list's one archive or delete dialog for this customer. */
  onRequestRemoval: (client: Client, removal: ClientRemoval) => void;
  /** The list owns the optimistic removal from the archived view, its rollback and the feedback. */
  onRestore: (client: Client) => Promise<void>;
};

interface ClientActionsMenuProps {
  client: Client;
  /** The row has a change in flight (edit settling, restore running). */
  isBusy?: boolean;
  actions: ClientRowActions;
}

export function ClientActionsMenu({ client, isBusy = false, actions }: ClientActionsMenuProps) {
  const router = useRouter();
  const [showEditDialog, setShowEditDialog] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button pending={isBusy} variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={isBusy}>
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Aktionen öffnen</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => router.push(`/kunden/${client.id}`)}>
            <ExternalLink className="size-4" />
            Details anzeigen
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil className="size-4" />
            Bearbeiten
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {actions.isArchivedView ? (
            <DropdownMenuItem onClick={() => void actions.onRestore(client)}>
              <ArchiveRestore className="size-4" />
              Wiederherstellen
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => actions.onRequestRemoval(client, 'archive')}>
              <Archive className="size-4" />
              Archivieren
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => actions.onRequestRemoval(client, 'delete')}>
            <Trash2 className="size-4" />
            Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditClientDialog
        client={client}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSaved={() => actions.onSaved(client.id)}
      />
    </>
  );
}
