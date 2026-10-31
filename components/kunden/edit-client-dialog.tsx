'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { updateClient, type UpdateClientInput } from '@/lib/clients/actions';
import type { Client, ClientType } from '@/lib/jobs/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { ClientFormFields } from './client-form-fields';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du bist nicht berechtigt, Kunden zu verwalten.',
  name_required: 'Bitte gib einen Namen ein.',
  client_not_found: 'Kunde nicht gefunden.',
  no_changes: 'Keine Änderungen vorgenommen.',
  update_failed: 'Fehler beim Aktualisieren des Kunden.',
};

interface EditClientDialogProps {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the server confirmed; the list marks the row until refreshed props land. */
  onSaved?: () => void;
}

/** The edit form's state, refilled on every opening, and its submit. */
function useEditClientForm({ client, open, onOpenChange, onSaved }: EditClientDialogProps) {
  const [name, setName] = useState(client.name);
  const [clientType, setClientType] = useState<ClientType>(client.clientType);
  const [email, setEmail] = useState(client.email ?? '');
  const [phone, setPhone] = useState(client.phone ?? '');
  const [address, setAddress] = useState(client.address ?? '');
  const [notes, setNotes] = useState(client.notes ?? '');
  const { run: runUpdate, isPending: isLoading } = useServerAction(updateClient);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const router = useRouter();
  const { showBanner } = useBanner();

  // Every opening, and another client while open, refills the form during render, never in an
  // effect. A refreshed object of the same client keeps what the user typed.
  const [resetFor, setResetFor] = useState({ open: false, clientId: client.id });
  if (open !== resetFor.open || client.id !== resetFor.clientId) {
    setResetFor({ open, clientId: client.id });
    if (open) {
      setName(client.name);
      setClientType(client.clientType);
      setEmail(client.email ?? '');
      setPhone(client.phone ?? '');
      setAddress(client.address ?? '');
      setNotes(client.notes ?? '');
      setError(null);
      setNameError(null);
      setHasAttemptedSubmit(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    const nextNameError = name.trim() ? undefined : 'Bitte gib einen Namen ein.';
    setNameError(nextNameError ?? null);
    if (focusFirstInvalidField({ 'edit-client-name': nextNameError })) return;

    try {
      const input: UpdateClientInput = {
        name: name.trim(),
        clientType,
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };

      const result = await runUpdate(client.id, input);

      if (result.success) {
        onOpenChange(false);
        onSaved?.();
        showBanner({ variant: 'success', message: 'Kunde gespeichert.' });
        router.refresh();
      } else {
        setError(describeFailure(result.error, ERROR_MESSAGES, 'Unbekannter Fehler'));
      }
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    }
  };

  return {
    values: { name, clientType, email, phone, address, notes },
    setters: { setName, setClientType, setEmail, setPhone, setAddress, setNotes },
    isLoading,
    error,
    nameError,
    setNameError,
    showNameError: hasAttemptedSubmit && nameError,
    handleSubmit,
  };
}

export function EditClientDialog(props: EditClientDialogProps) {
  const { open, onOpenChange } = props;
  const form = useEditClientForm(props);
  const { values, setters, isLoading, nameError } = form;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isLoading}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Kunde bearbeiten</DialogTitle>
          <DialogDescription>Ändere die Daten des Kunden.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <ClientFormFields
              idPrefix="edit-client"
              values={values}
              nameError={form.showNameError || undefined}
              disabled={isLoading}
              onNameChange={(value) => {
                setters.setName(value);
                if (nameError) form.setNameError(null);
              }}
              onClientTypeChange={setters.setClientType}
              onEmailChange={setters.setEmail}
              onPhoneChange={setters.setPhone}
              onAddressChange={setters.setAddress}
              onNotesChange={setters.setNotes}
            />
            <ErrorText>{form.error}</ErrorText>
          </div>
          <DialogFooter>
            <Button pending={isLoading} type="submit" disabled={isLoading}>
              {isLoading ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
