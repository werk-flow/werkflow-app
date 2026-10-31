'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { createOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { createClient, type CreateClientInput } from '@/lib/clients/actions';
import type { Client, ClientType } from '@/lib/jobs/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { ClientFormFields, type ClientFormValues } from './client-form-fields';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du bist nicht berechtigt, Kunden zu verwalten.',
  name_required: 'Bitte gib einen Namen ein.',
  create_failed: 'Fehler beim Erstellen des Kunden.',
};

function describeCreateFailure(error: string): string {
  return describeFailure(error, ERROR_MESSAGES, 'Unbekannter Fehler');
}

/**
 * The customer list (`KundenContent`) subscribes here: the page header mounts
 * this dialog outside the list's Suspense boundary, so the optimistic row
 * travels over a channel instead of a callback.
 */
export const clientCreations = createOptimisticChannel<Client>();

function draftClient(tempId: string, input: CreateClientInput): Client {
  const now = new Date().toISOString();
  return {
    id: tempId,
    organizationId: '',
    name: input.name,
    clientType: input.clientType,
    customerNumber: null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function createClientInput(values: ClientFormValues): CreateClientInput {
  const { name, clientType, email, phone, address, notes } = values;
  return {
    name: name.trim(),
    clientType,
    ...(email.trim() ? { email: email.trim() } : {}),
    ...(phone.trim() ? { phone: phone.trim() } : {}),
    ...(address.trim() ? { address: address.trim() } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
  };
}

/**
 * List page: the dialog has closed and the list shows the draft as a pending
 * row; the server's answer commits or rolls it back (feedback canon).
 */
async function settleClientCreation(
  tempId: string,
  input: CreateClientInput,
  showBanner: ReturnType<typeof useBanner>['showBanner'],
): Promise<void> {
  const result = await createClient(input).catch(() => null);
  if (!result || !result.success) {
    clientCreations.publish({ kind: 'rollback', tempId });
    const reason = describeCreateFailure(result?.error ?? 'unexpected_error');
    showBanner({
      variant: 'error',
      message: `Kunde „${input.name}“ konnte nicht angelegt werden: ${reason}`,
    });
    return;
  }
  clientCreations.publish({ kind: 'commit', tempId, confirmed: result.client });
  showBanner({ variant: 'success', message: 'Kunde erfolgreich erstellt!' });
  // No router.refresh(): createClient revalidates nothing, so the list page
  // renders no route for this save. The list's post-save read and the route
  // snapshot effect reconcile the confirmed row.
}

interface CreateClientDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClientCreated?: (client: Client) => void;
}

/** The create form's state and its submit; `setOpen` closes the dialog. */
function useCreateClientForm(
  setOpen: (open: boolean) => void,
  onClientCreated: ((client: Client) => void) | undefined,
) {
  const [name, setName] = useState('');
  const [clientType, setClientType] = useState<ClientType>('privat');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const { run: runCreate, isPending: isLoading } = useServerAction(createClient);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const router = useRouter();
  const { showBanner } = useBanner();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    const nextNameError = name.trim() ? undefined : 'Bitte gib einen Namen ein.';
    setNameError(nextNameError ?? null);
    if (focusFirstInvalidField({ 'client-name': nextNameError })) return;

    const input = createClientInput({ name, clientType, email, phone, address, notes });

    if (onClientCreated) {
      // Select-with-create: the caller needs the confirmed record to select
      // it, so the button spins until the server answers.
      try {
        const result = await runCreate(input);
        if (!result.success) {
          setError(describeCreateFailure(result.error));
          return;
        }
        onClientCreated(result.client);
        resetForm();
        setOpen(false);
        showBanner({ variant: 'success', message: 'Kunde erfolgreich erstellt!' });
        router.refresh();
      } catch {
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      }
      return;
    }

    // List page: the dialog closes at once and the list shows the draft as a
    // pending row until the server confirms (feedback canon).
    const tempId = crypto.randomUUID();
    clientCreations.publish({ kind: 'insert', tempId, draft: draftClient(tempId, input) });
    resetForm();
    setOpen(false);
    await settleClientCreation(tempId, input, showBanner);
  };

  const resetForm = () => {
    setName('');
    setClientType('privat');
    setEmail('');
    setPhone('');
    setAddress('');
    setNotes('');
    setHasAttemptedSubmit(false);
    setNameError(null);
  };

  return {
    values: { name, clientType, email, phone, address, notes },
    setters: { setName, setClientType, setEmail, setPhone, setAddress, setNotes },
    isLoading,
    error,
    setError,
    nameError,
    setNameError,
    showNameError: hasAttemptedSubmit && nameError,
    handleSubmit,
    resetForm,
  };
}

export function CreateClientDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onClientCreated,
}: CreateClientDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setInternalOpen;

  const form = useCreateClientForm(setOpen, onClientCreated);
  const { values, setters, isLoading, error, nameError } = form;

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      form.resetForm();
      form.setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isLoading}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">Kunde hinzufügen</span>
            <span className="sm:hidden" aria-hidden="true">
              Hinzufügen
            </span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Neuen Kunden anlegen</DialogTitle>
          <DialogDescription>Erstelle einen neuen Kunden für deine Organisation.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.stopPropagation();
            // handleSubmit reports its own failures in the dialog or a banner.
            void form.handleSubmit(e);
          }}
          noValidate
        >
          <div className="grid gap-4 py-4">
            <ClientFormFields
              idPrefix="client"
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
            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            <Button pending={isLoading} type="submit" disabled={isLoading}>
              {isLoading ? 'Wird erstellt…' : 'Kunde erstellen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
