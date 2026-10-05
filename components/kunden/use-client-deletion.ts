'use client';

import { useRef, useState } from 'react';

import { describeFailure } from '@/lib/action-messages';
import { deleteClient } from '@/lib/clients/actions';
import { loadDocument } from '@/lib/navigation/document-load';

export const CLIENT_DELETE_ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Kunden zu löschen.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
} satisfies Record<string, string>;

const CLIENT_DELETE_FAILED_MESSAGE = 'Fehler beim Löschen des Kunden';

interface ClientDeletion {
  showDeleteDialog: boolean;
  setShowDeleteDialog: (open: boolean) => void;
  isDeleting: boolean;
  /** Read by event handlers that must see the deletion before the next render. */
  isDeletingRef: React.RefObject<boolean>;
  deleteError: string | null;
  handleDelete: () => Promise<void>;
}

/** Confirm-dialog state and the delete action of the customer detail page. */
export function useClientDeletion(client: { id: string; name: string }): ClientDeletion {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isDeletingRef = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (isDeleting) return;
    isDeletingRef.current = true;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteClient(client.id);
      if (result.success) {
        // Full document load: a soft router.push after this server action can
        // fail to commit (the deletion stall: DELETE succeeds, the URL never
        // changes), and the deleted record's page would redirect first and drop
        // the banner parameter. Leaving it loses no state worth keeping.
        loadDocument(`/kunden?deleted_client=${encodeURIComponent(client.name)}`);
        return;
      }

      isDeletingRef.current = false;
      setDeleteError(
        describeFailure(result.error, CLIENT_DELETE_ERROR_MESSAGES, CLIENT_DELETE_FAILED_MESSAGE),
      );
      setIsDeleting(false);
    } catch {
      isDeletingRef.current = false;
      setIsDeleting(false);
      setDeleteError(CLIENT_DELETE_FAILED_MESSAGE);
    }
  };

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    isDeleting,
    isDeletingRef,
    deleteError,
    handleDelete,
  };
}
