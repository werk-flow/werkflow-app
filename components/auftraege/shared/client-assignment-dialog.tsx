'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionsLoadError } from './options-load-error';
import { ClientSelectWithCreate } from './client-select-with-create';
import type { Client } from '@/lib/jobs/types';

interface ClientAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  currentClientId?: string | null;
  title?: string;
  isSaving?: boolean;
  /** Failure of the last save; the dialog stays open while it is set. */
  saveError?: string | null;
  /** The on-demand option load; its failure shows with a retry. */
  optionsLoad?: { error: string | null; retry: () => void; isLoading: boolean } | undefined;
  onSave: (clientId: string) => Promise<void> | void;
}

export function ClientAssignmentDialog({
  open,
  onOpenChange,
  clients,
  currentClientId,
  title = 'Kunde zuweisen',
  isSaving = false,
  saveError,
  optionsLoad,
  onSave,
}: ClientAssignmentDialogProps) {
  const [selectedClientId, setSelectedClientId] = useState(currentClientId ?? '');

  // Every opening, and a new client while open, resets the draft during render, never in an effect.
  const [resetFor, setResetFor] = useState({ open: false, currentClientId });
  if (open !== resetFor.open || currentClientId !== resetFor.currentClientId) {
    setResetFor({ open, currentClientId });
    if (open) setSelectedClientId(currentClientId ?? '');
  }

  const handleSave = async () => {
    await onSave(selectedClientId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isSaving}>
      <DialogContent size="md" className="overflow-visible sm:top-[47%] sm:translate-y-[-47%]">
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

          {optionsLoad && (
            <OptionsLoadError
              error={optionsLoad.error}
              onRetry={optionsLoad.retry}
              retrying={optionsLoad.isLoading}
            />
          )}
          <ErrorText>{saveError}</ErrorText>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} onClick={handleSave} disabled={isSaving}>
              Speichern
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
