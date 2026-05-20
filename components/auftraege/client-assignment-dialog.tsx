'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClientSelectWithCreate } from './client-select-with-create';
import type { Client } from '@/lib/jobs/types';

interface ClientAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  currentClientId?: string | null;
  title?: string;
  isSaving?: boolean;
  onSave: (clientId: string) => Promise<void> | void;
}

export function ClientAssignmentDialog({
  open,
  onOpenChange,
  clients,
  currentClientId,
  title = 'Kunde zuweisen',
  isSaving = false,
  onSave,
}: ClientAssignmentDialogProps) {
  const [selectedClientId, setSelectedClientId] = useState(currentClientId ?? '');

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the local dialog draft whenever the dialog is opened for a different client
    setSelectedClientId(currentClientId ?? '');
  }, [open, currentClientId]);

  const handleSave = async () => {
    await onSave(selectedClientId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-visible sm:top-[47%] sm:max-w-[420px] sm:translate-y-[-47%]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <ClientSelectWithCreate
            clients={clients}
            value={selectedClientId}
            onValueChange={setSelectedClientId}
            disabled={isSaving}
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
