'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, ExternalLink, Pencil, Trash2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { EditClientDialog } from './edit-client-dialog';
import type { Client } from '@/lib/jobs/types';

interface ClientActionsMenuProps {
  client: Client;
  /** The row has a change in flight (edit settling, delete running). */
  isBusy?: boolean;
  /** An edit was confirmed by the server; the list keeps the row marked until props land. */
  onSaved: (clientId: string) => void;
  /** The list owns the optimistic removal, its rollback, and the feedback. */
  onDelete: (client: Client) => Promise<void>;
}

export function ClientActionsMenu({
  client,
  isBusy = false,
  onSaved,
  onDelete,
}: ClientActionsMenuProps) {
  const router = useRouter();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={isBusy}
          >
            {isBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
            <span className="sr-only">Aktionen öffnen</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => router.push(`/kunden/${client.id}`)}
          >
            <ExternalLink className="size-4" />
            Details anzeigen
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil className="size-4" />
            Bearbeiten
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="size-4" />
            Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditClientDialog
        client={client}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSaved={() => onSaved(client.id)}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kunde löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du{' '}
              <span className="font-medium">{client.name}</span> löschen
              möchtest? Bestehende Aufträge und Projekte verlieren die
              Zuordnung zu diesem Kunden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            {/* The row leaves the list at once; the list rolls it back and
                reports a failure, so the confirm can close immediately. */}
            <AlertDialogAction
              onClick={() => void onDelete(client)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
