'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { createOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { createClient, type CreateClientInput } from '@/lib/clients/actions';
import { CLIENT_TYPE_LABELS, type Client, type ClientType } from '@/lib/jobs/types';

const CLIENT_TYPE_OPTIONS: { value: ClientType; label: string }[] = [
  { value: 'privat', label: CLIENT_TYPE_LABELS.privat },
  { value: 'gewerblich', label: CLIENT_TYPE_LABELS.gewerblich }
];

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Kunden zu verwalten.',
  name_required: 'Bitte gib einen Namen ein.',
  create_failed: 'Fehler beim Erstellen des Kunden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

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
    updatedAt: now
  };
}

interface CreateClientDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClientCreated?: (client: Client) => void;
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

  const [name, setName] = useState('');
  const [clientType, setClientType] = useState<ClientType>('privat');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { showBanner } = useBanner();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setNameError(null);

    if (!name.trim()) {
      setNameError('Bitte gib einen Namen ein.');
      nameInputRef.current?.focus();
      return;
    }

    const input: CreateClientInput = {
      name: name.trim(),
      clientType,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
      notes: notes.trim() || undefined
    };

    if (onClientCreated) {
      // Select-with-create: the caller needs the confirmed record to select
      // it, so the button spins until the server answers.
      setIsLoading(true);
      try {
        const result = await createClient(input);
        if (!result.success) {
          setError(ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler');
          return;
        }
        onClientCreated(result.client);
        resetForm();
        setOpen(false);
        showBanner({ variant: 'success', message: 'Kunde erfolgreich erstellt!' });
        router.refresh();
      } catch {
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // List page: the dialog closes at once and the list shows the draft as a
    // pending row until the server confirms (feedback canon).
    const tempId = crypto.randomUUID();
    clientCreations.publish({ kind: 'insert', tempId, draft: draftClient(tempId, input) });
    resetForm();
    setOpen(false);

    const result = await createClient(input).catch(() => null);
    if (!result || !result.success) {
      clientCreations.publish({ kind: 'rollback', tempId });
      const reason = result ? ERROR_MESSAGES[result.error] || result.error : ERROR_MESSAGES.unexpected_error;
      showBanner({
        variant: 'error',
        message: `Kunde „${input.name}" konnte nicht angelegt werden: ${reason}`
      });
      return;
    }
    clientCreations.publish({ kind: 'commit', tempId, confirmed: result.client });
    showBanner({ variant: 'success', message: 'Kunde erfolgreich erstellt!' });
    router.refresh();
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

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
      setError(null);
    }
  };

  const showNameError = hasAttemptedSubmit && nameError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Kunde hinzufügen</span>
            <span className="sm:hidden">Hinzufügen</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neuen Kunden anlegen</DialogTitle>
          <DialogDescription>
            Erstelle einen neuen Kunden für deine Organisation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.stopPropagation(); handleSubmit(e); }} noValidate>
          <div className="grid gap-4 py-4">
            <Field label="Name" htmlFor="client-name" required error={showNameError || undefined}>
              <Input
                ref={nameInputRef}
                placeholder="Kundenname"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                disabled={isLoading}
              />
            </Field>
            <Field label="Typ" htmlFor="client-type">
              <Select
                value={clientType}
                onValueChange={(value) => setClientType(value as ClientType)}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Typ auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="E-Mail" htmlFor="client-email">
              <Input
                type="text"
                inputMode="email"
                placeholder="kunde@beispiel.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </Field>
            <Field label="Telefon" htmlFor="client-phone">
              <Input
                type="tel"
                placeholder="+49 123 456789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={isLoading}
              />
            </Field>
            <Field label="Adresse" htmlFor="client-address">
              <Input
                placeholder="Straße, PLZ Ort"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={isLoading}
              />
            </Field>
            <Field label="Notizen" htmlFor="client-notes">
              <Textarea
                placeholder="Optionale Notizen zum Kunden..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isLoading}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird erstellt...' : 'Kunde erstellen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
